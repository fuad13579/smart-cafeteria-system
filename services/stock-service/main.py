import os
import time
from typing import Any

import psycopg
import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

chaos_state = {"enabled": False, "mode": "error"}

metrics: dict[str, float] = {
    "reserve_total": 0,
    "reserve_failed_total": 0,
    "release_total": 0,
    "release_failed_total": 0,
}


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


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


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

    try:
        _redis_client().ping()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"redis unavailable: {exc}")

    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    return {
        "reserve_total": metrics["reserve_total"],
        "reserve_failed_total": metrics["reserve_failed_total"],
        "release_total": metrics["release_total"],
        "release_failed_total": metrics["release_failed_total"],
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

    rc = _redis_client()
    lock_key = f"lock:reserve:{payload.order_id}:{payload.item_id}"
    got_lock = rc.set(lock_key, "1", ex=10, nx=True)
    if not got_lock:
        metrics["reserve_failed_total"] += 1
        raise HTTPException(status_code=409, detail="Reservation already in progress")

    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                # Idempotency: same order+item repeated should not deduct again.
                cur.execute(
                    """
                    SELECT qty, status
                    FROM stock_reservations
                    WHERE order_id = %s AND item_id = %s
                    """,
                    (payload.order_id, payload.item_id),
                )
                reservation = cur.fetchone()
                if reservation:
                    reserved_qty, status = reservation
                    if status == "RESERVED":
                        if int(reserved_qty) != payload.qty:
                            metrics["reserve_failed_total"] += 1
                            raise HTTPException(status_code=409, detail="Reservation exists with different qty")
                        return {
                            "reserved": True,
                            "already_reserved": True,
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

        return {
            "reserved": True,
            "already_reserved": False,
            "order_id": payload.order_id,
            "item_id": payload.item_id,
            "qty": payload.qty,
        }
    finally:
        rc.delete(lock_key)


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
                WHERE order_id = %s AND status = 'RESERVED'
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

            cur.execute(
                "UPDATE stock_reservations SET status = 'RELEASED' WHERE order_id = %s AND status = 'RESERVED'",
                (payload.order_id,),
            )
            conn.commit()

    return {"released": True, "already_released": False, "order_id": payload.order_id}
