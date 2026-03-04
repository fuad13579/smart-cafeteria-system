import json
import os
import threading
import time
from typing import Any

import pika
import psycopg
import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

chaos_state = {"enabled": False, "mode": "error"}

metrics: dict[str, float] = {
    "reserve_total": 0,
    "reserve_failed_total": 0,
    "confirm_total": 0,
    "confirm_failed_total": 0,
    "release_total": 0,
    "release_failed_total": 0,
    "ttl_released_total": 0,
}
reaper_state = {"running": True}


def _reservation_ttl_seconds() -> int:
    raw = os.getenv("RESERVATION_TTL_SECONDS", "300")
    try:
        value = int(raw)
        return value if value > 0 else 300
    except ValueError:
        return 300


def _reservation_reaper_interval_seconds() -> int:
    raw = os.getenv("RESERVATION_REAPER_INTERVAL_SECONDS", "5")
    try:
        value = int(raw)
        return value if value > 0 else 5
    except ValueError:
        return 5


def _db_conn():
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "cafeteria"),
        user=os.getenv("POSTGRES_USER", "cafeteria"),
        password=os.getenv("POSTGRES_PASSWORD", "cafeteria"),
    )


def _redis_client():
    return redis.Redis(
        host=os.getenv("REDIS_HOST", "redis"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        decode_responses=True,
    )


def _rabbit_params() -> pika.ConnectionParameters:
    host = os.getenv("RABBITMQ_HOST", "rabbitmq")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    return pika.ConnectionParameters(host=host, port=port)


def _publish_cache_invalidation(event: str, item_id: str | None = None) -> None:
    payload: dict[str, Any] = {"event": event, "ts": int(time.time())}
    if item_id:
        payload["item_id"] = item_id
    try:
        connection = pika.BlockingConnection(_rabbit_params())
        channel = connection.channel()
        channel.queue_declare(queue="cache.invalidate", durable=True)
        channel.basic_publish(
            exchange="",
            routing_key="cache.invalidate",
            body=json.dumps(payload),
            properties=pika.BasicProperties(delivery_mode=2),
        )
        connection.close()
    except Exception:
        # Best effort only; stock correctness depends on DB locks/transactions.
        pass


def _should_fail() -> None:
    if not chaos_state["enabled"]:
        return
    if chaos_state["mode"] == "timeout":
        time.sleep(2)
    raise HTTPException(status_code=503, detail="Service in chaos mode")


class ReserveRequest(BaseModel):
    order_id: str
    item_id: str
    qty: int


class ReleaseRequest(BaseModel):
    order_id: str


class ConfirmRequest(BaseModel):
    order_id: str


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


def _ensure_stock_reservation_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE stock_reservations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_stock_reservations_status_confirmed_created
                ON stock_reservations(status, confirmed_at, created_at)
                """
            )
            conn.commit()


def _release_expired_reservations_once() -> int:
    ttl_seconds = _reservation_ttl_seconds()
    released = 0
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, item_id, qty
                FROM stock_reservations
                WHERE status = 'RESERVED'
                  AND confirmed_at IS NULL
                  AND created_at <= NOW() - (%s || ' seconds')::interval
                FOR UPDATE SKIP LOCKED
                LIMIT 100
                """,
                (ttl_seconds,),
            )
            rows = cur.fetchall()
            for reservation_id, item_id, qty in rows:
                cur.execute(
                    """
                    UPDATE menu_items
                    SET stock_quantity = stock_quantity + %s,
                        available = TRUE
                    WHERE id = %s
                    """,
                    (qty, item_id),
                )
                cur.execute(
                    """
                    UPDATE stock_reservations
                    SET status = 'RELEASED'
                    WHERE id = %s
                      AND status = 'RESERVED'
                      AND confirmed_at IS NULL
                    """,
                    (reservation_id,),
                )
                _publish_cache_invalidation("stock.changed", item_id=str(item_id))
                released += 1
            conn.commit()
    return released


def _reservation_reaper_loop() -> None:
    interval = _reservation_reaper_interval_seconds()
    while reaper_state["running"]:
        try:
            released = _release_expired_reservations_once()
            if released > 0:
                metrics["ttl_released_total"] += released
        except Exception:
            pass
        time.sleep(interval)


@app.on_event("startup")
def on_startup() -> None:
    _ensure_stock_reservation_schema()
    threading.Thread(target=_reservation_reaper_loop, daemon=True).start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    reaper_state["running"] = False


@app.get("/health")
def health():
    if chaos_state["enabled"]:
        raise HTTPException(status_code=503, detail="chaos mode enabled")

    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database unavailable: {exc}")

    redis_ok = True
    try:
        _redis_client().ping()
    except Exception:
        redis_ok = False

    return {"status": "ok", "redis_cache": "ok" if redis_ok else "degraded"}


@app.get("/metrics")
def get_metrics():
    return {
        "reserve_total": metrics["reserve_total"],
        "reserve_failed_total": metrics["reserve_failed_total"],
        "confirm_total": metrics["confirm_total"],
        "confirm_failed_total": metrics["confirm_failed_total"],
        "release_total": metrics["release_total"],
        "release_failed_total": metrics["release_failed_total"],
        "ttl_released_total": metrics["ttl_released_total"],
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.get("/stock/{item_id}")
def get_stock(item_id: str):
    _should_fail()

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, available, stock_quantity FROM menu_items WHERE id = %s", (item_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            return {"id": row[0], "name": row[1], "available": bool(row[2]), "stock_quantity": int(row[3])}


@app.post("/stock/reserve")
def reserve_stock(payload: ReserveRequest):
    _should_fail()
    metrics["reserve_total"] += 1

    if payload.qty <= 0:
        metrics["reserve_failed_total"] += 1
        raise HTTPException(status_code=422, detail="qty must be positive")

    rc = None
    try:
        rc = _redis_client()
    except Exception:
        rc = None
    lock_key = f"lock:reserve:{payload.order_id}:{payload.item_id}"
    got_lock = True
    if rc is not None:
        try:
            got_lock = bool(rc.set(lock_key, "1", ex=10, nx=True))
        except Exception:
            # Redis lock degraded; continue with DB transactional lock as source of truth.
            got_lock = True
    if not got_lock:
        metrics["reserve_failed_total"] += 1
        raise HTTPException(status_code=409, detail="Reservation already in progress")

    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                # Idempotency: same order+item repeated should not deduct again.
                cur.execute(
                    """
                    SELECT qty, status, confirmed_at
                    FROM stock_reservations
                    WHERE order_id = %s AND item_id = %s
                    """,
                    (payload.order_id, payload.item_id),
                )
                reservation = cur.fetchone()
                if reservation:
                    reserved_qty, status, confirmed_at = reservation
                    if status == "RESERVED":
                        if int(reserved_qty) != payload.qty:
                            metrics["reserve_failed_total"] += 1
                            raise HTTPException(status_code=409, detail="Reservation exists with different qty")
                        return {
                            "reserved": True,
                            "already_reserved": True,
                            "already_confirmed": confirmed_at is not None,
                            "order_id": payload.order_id,
                            "item_id": payload.item_id,
                            "qty": payload.qty,
                        }
                    metrics["reserve_failed_total"] += 1
                    raise HTTPException(status_code=409, detail="Reservation already released")

                cur.execute("SELECT stock_quantity FROM menu_items WHERE id = %s FOR UPDATE", (payload.item_id,))
                row = cur.fetchone()
                if not row:
                    metrics["reserve_failed_total"] += 1
                    raise HTTPException(status_code=404, detail="Item not found")

                current_qty = int(row[0])
                if current_qty < payload.qty:
                    metrics["reserve_failed_total"] += 1
                    raise HTTPException(status_code=409, detail="Insufficient stock")

                new_qty = current_qty - payload.qty
                cur.execute(
                    "UPDATE menu_items SET stock_quantity = %s, available = %s WHERE id = %s",
                    (new_qty, new_qty > 0, payload.item_id),
                )
                cur.execute(
                    """
                    INSERT INTO stock_reservations(order_id, item_id, qty, status)
                    VALUES (%s, %s, %s, 'RESERVED')
                    """,
                    (payload.order_id, payload.item_id, payload.qty),
                )
                conn.commit()
                _publish_cache_invalidation("stock.changed", item_id=payload.item_id)

        return {
            "reserved": True,
            "already_reserved": False,
            "order_id": payload.order_id,
            "item_id": payload.item_id,
            "qty": payload.qty,
        }
    finally:
        if rc is not None:
            try:
                rc.delete(lock_key)
            except Exception:
                pass


@app.post("/stock/confirm")
def confirm_stock(payload: ConfirmRequest):
    _should_fail()
    metrics["confirm_total"] += 1

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE status = 'RESERVED' AND confirmed_at IS NULL) AS pending_count,
                  COUNT(*) FILTER (WHERE status = 'RESERVED' AND confirmed_at IS NOT NULL) AS confirmed_count,
                  COUNT(*) FILTER (WHERE status = 'RELEASED') AS released_count
                FROM stock_reservations
                WHERE order_id = %s
                """,
                (payload.order_id,),
            )
            row = cur.fetchone()
            pending_count = int(row[0] or 0) if row else 0
            confirmed_count = int(row[1] or 0) if row else 0
            released_count = int(row[2] or 0) if row else 0

            if pending_count == 0:
                if confirmed_count > 0:
                    return {
                        "confirmed": True,
                        "already_confirmed": True,
                        "order_id": payload.order_id,
                    }
                if released_count > 0:
                    metrics["confirm_failed_total"] += 1
                    raise HTTPException(status_code=409, detail="Reservation already released")
                metrics["confirm_failed_total"] += 1
                raise HTTPException(status_code=404, detail="Reservation not found")

            cur.execute(
                """
                UPDATE stock_reservations
                SET confirmed_at = NOW()
                WHERE order_id = %s
                  AND status = 'RESERVED'
                  AND confirmed_at IS NULL
                """,
                (payload.order_id,),
            )
            conn.commit()

    return {
        "confirmed": True,
        "already_confirmed": False,
        "order_id": payload.order_id,
    }


@app.post("/stock/release")
def release_stock(payload: ReleaseRequest):
    _should_fail()
    metrics["release_total"] += 1

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT item_id, qty
                FROM stock_reservations
                WHERE order_id = %s
                  AND status = 'RESERVED'
                  AND confirmed_at IS NULL
                FOR UPDATE
                """,
                (payload.order_id,),
            )
            rows = cur.fetchall()
            if not rows:
                # Idempotent release: already released or missing
                return {"released": True, "already_released": True, "order_id": payload.order_id}

            for item_id, qty in rows:
                cur.execute(
                    """
                    UPDATE menu_items
                    SET stock_quantity = stock_quantity + %s,
                        available = TRUE
                    WHERE id = %s
                    """,
                    (qty, item_id),
                )
                _publish_cache_invalidation("stock.changed", item_id=str(item_id))

            cur.execute(
                """
                UPDATE stock_reservations
                SET status = 'RELEASED'
                WHERE order_id = %s
                  AND status = 'RESERVED'
                  AND confirmed_at IS NULL
                """,
                (payload.order_id,),
            )
            conn.commit()

    return {"released": True, "already_released": False, "order_id": payload.order_id}
