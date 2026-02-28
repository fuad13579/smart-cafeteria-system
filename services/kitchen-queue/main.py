import json
import os
import random
import threading
import time

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


def _publish_status(order_id: str, from_status: str, to_status: str, eta_minutes: int) -> None:
    payload = {
        "event": "order.status.changed",
        "event_id": f"evt-{int(time.time()*1000)}",
        "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "order_id": order_id,
        "from_status": from_status,
        "to_status": to_status,
        "eta_minutes": eta_minutes,
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


def _set_order_status(order_id: str, status_value: str, eta_minutes: int) -> bool:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE orders SET status = %s, eta_minutes = %s WHERE id = %s",
                (status_value, eta_minutes, order_id),
            )
            conn.commit()
            return cur.rowcount == 1


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

    if _set_order_status(order_id, "IN_PROGRESS", 7):
        _publish_status(order_id, "QUEUED", "IN_PROGRESS", 7)

    time.sleep(random.randint(3, 7))

    if _set_order_status(order_id, "READY", 0):
        _publish_status(order_id, "IN_PROGRESS", "READY", 0)
        metrics["orders_processed_total"] += 1


def _worker_loop() -> None:
    while worker_state["running"]:
        try:
            connection = pika.BlockingConnection(_rabbit_params())
            channel = connection.channel()
            channel.queue_declare(queue="kitchen.jobs", durable=True)

            method_frame, _, body = channel.basic_get(queue="kitchen.jobs", auto_ack=False)
            if method_frame is None:
                connection.close()
                time.sleep(1)
                continue

            try:
                _process_message(body)
                channel.basic_ack(delivery_tag=method_frame.delivery_tag)
            except Exception:
                metrics["failures_total"] += 1
                channel.basic_nack(delivery_tag=method_frame.delivery_tag, requeue=True)
            finally:
                connection.close()

        except Exception:
            metrics["failures_total"] += 1
            time.sleep(1)


@app.on_event("startup")
def on_startup():
    threading.Thread(target=_worker_loop, daemon=True).start()


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
