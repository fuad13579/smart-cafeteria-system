import json
import os
import random
import threading
import time
from datetime import datetime, timedelta, timezone

import pika
import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

chaos_state = {"enabled": False, "mode": "error"}
worker_state = {"running": True}

metrics: dict[str, float] = {
    "orders_processed_total": 0,
    "failures_total": 0,
}


def _db_conn():
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "cafeteria"),
        user=os.getenv("POSTGRES_USER", "cafeteria"),
        password=os.getenv("POSTGRES_PASSWORD", "cafeteria"),
    )


def _rabbit_params() -> pika.ConnectionParameters:
    host = os.getenv("RABBITMQ_HOST", "rabbitmq")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    return pika.ConnectionParameters(host=host, port=port)


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


def _ensure_order_ready_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_counter INTEGER NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_until TIMESTAMPTZ")
            conn.commit()


def _ready_window_minutes() -> int:
    raw = os.getenv("ORDER_READY_WINDOW_MINUTES", "15")
    try:
        value = int(raw)
        return value if value > 0 else 15
    except ValueError:
        return 15


def _consumer_threads() -> int:
    raw = os.getenv("KITCHEN_CONSUMER_THREADS", "2")
    try:
        value = int(raw)
        return value if value > 0 else 2
    except ValueError:
        return 2


def _prefetch_count() -> int:
    raw = os.getenv("KITCHEN_PREFETCH_COUNT", "20")
    try:
        value = int(raw)
        return value if value > 0 else 20
    except ValueError:
        return 20


def _publish_status(
    order_id: str,
    from_status: str,
    to_status: str,
    eta_minutes: int,
    token_no: int | None = None,
    pickup_counter: int | None = None,
    ready_until: datetime | None = None,
) -> None:
    payload = {
        "event": "order.status.changed",
        "type": "order.status",
        "event_id": f"evt-{int(time.time()*1000)}",
        "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "order_id": order_id,
        "from_status": from_status,
        "to_status": to_status,
        "status": to_status,
        "eta_minutes": eta_minutes,
        "token_no": token_no,
        "pickup_counter": pickup_counter,
        "ready_until": ready_until.isoformat() if ready_until else None,
    }

    connection = pika.BlockingConnection(_rabbit_params())
    channel = connection.channel()
    channel.queue_declare(queue="order.status", durable=True)
    channel.basic_publish(
        exchange="",
        routing_key="order.status",
        body=json.dumps(payload),
        properties=pika.BasicProperties(delivery_mode=2),
    )
    connection.close()


def _set_order_status(order_id: str, from_status: str, to_status: str, eta_minutes: int) -> dict | None:
    ready_at = None
    ready_until = None
    if to_status == "READY":
        ready_at = datetime.now(timezone.utc)
        ready_until = ready_at + timedelta(minutes=_ready_window_minutes())

    with _db_conn() as conn:
        with conn.cursor() as cur:
            if to_status == "READY":
                cur.execute(
                    """
                    UPDATE orders
                    SET status = %s, eta_minutes = %s, ready_at = %s, ready_until = %s
                    WHERE id = %s AND status = %s
                    RETURNING token_no, pickup_counter, ready_until
                    """,
                    (to_status, eta_minutes, ready_at, ready_until, order_id, from_status),
                )
            else:
                cur.execute(
                    """
                    UPDATE orders
                    SET status = %s, eta_minutes = %s
                    WHERE id = %s AND status = %s
                    RETURNING token_no, pickup_counter, ready_until
                    """,
                    (to_status, eta_minutes, order_id, from_status),
                )
            row = cur.fetchone()
            conn.commit()
            if not row:
                return None
            return {
                "token_no": int(row[0]) if row[0] is not None else None,
                "pickup_counter": int(row[1]) if row[1] is not None else None,
                "ready_until": row[2],
            }


def _process_message(body: bytes) -> None:
    data = json.loads(body.decode("utf-8"))
    order_id = data.get("order_id")
    if not order_id:
        metrics["failures_total"] += 1
        return

    if chaos_state["enabled"]:
        if chaos_state["mode"] == "timeout":
            time.sleep(2)
        metrics["failures_total"] += 1
        return

    first = _set_order_status(order_id, "QUEUED", "IN_PROGRESS", 7)
    if first:
        _publish_status(
            order_id,
            "QUEUED",
            "IN_PROGRESS",
            7,
            token_no=first.get("token_no"),
            pickup_counter=first.get("pickup_counter"),
            ready_until=first.get("ready_until"),
        )

    time.sleep(random.randint(3, 7))

    second = _set_order_status(order_id, "IN_PROGRESS", "READY", 0)
    if second:
        _publish_status(
            order_id,
            "IN_PROGRESS",
            "READY",
            0,
            token_no=second.get("token_no"),
            pickup_counter=second.get("pickup_counter"),
            ready_until=second.get("ready_until"),
        )
        metrics["orders_processed_total"] += 1


def _worker_loop(worker_name: str) -> None:
    while worker_state["running"]:
        try:
            connection = pika.BlockingConnection(_rabbit_params())
            channel = connection.channel()
            channel.queue_declare(queue="kitchen.jobs", durable=True)
            channel.basic_qos(prefetch_count=_prefetch_count())

            def _on_message(ch, method, _props, body):
                try:
                    _process_message(body)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception:
                    metrics["failures_total"] += 1
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

            channel.basic_consume(queue="kitchen.jobs", on_message_callback=_on_message, auto_ack=False)
            channel.start_consuming()

        except Exception:
            metrics["failures_total"] += 1
            time.sleep(1)
        finally:
            try:
                connection.close()
            except Exception:
                pass


@app.on_event("startup")
def on_startup():
    _ensure_order_ready_schema()
    for i in range(_consumer_threads()):
        threading.Thread(target=_worker_loop, args=(f"worker-{i+1}",), daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    worker_state["running"] = False


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
        connection = pika.BlockingConnection(_rabbit_params())
        connection.close()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"rabbitmq unavailable: {exc}")

    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    return {
        "orders_processed_total": metrics["orders_processed_total"],
        "failures_total": metrics["failures_total"],
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}
