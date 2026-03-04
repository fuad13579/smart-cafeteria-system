import asyncio
import json
import os
import threading
import time
from typing import Any

import httpx
import pika
import psycopg
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

app = FastAPI()

active_sockets: dict[WebSocket, str | None] = {}
loop_ref: dict[str, asyncio.AbstractEventLoop | None] = {"loop": None}
worker_state = {"running": True}
chaos_state = {"enabled": False, "mode": "error"}

metrics: dict[str, float] = {
    "events_total": 0,
    "push_failures_total": 0,
    "connected_clients": 0,
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


def _identity_url() -> str:
    base = os.getenv("IDENTITY_PROVIDER_URL", "http://identity-provider:8000")
    return base.rstrip("/")


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


def _token_valid(token: str) -> bool:
    if not token:
        return False
    try:
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(f"{_identity_url()}/verify", headers={"Authorization": f"Bearer {token}"})
            return resp.status_code == 200
    except Exception:
        return False


async def _broadcast(payload: dict[str, Any]) -> None:
    order_id = str(payload.get("order_id") or "")
    dead: list[WebSocket] = []
    for ws, order_filter in list(active_sockets.items()):
        if order_filter and order_filter != order_id:
            continue
        try:
            await ws.send_json(payload)
        except Exception:
            metrics["push_failures_total"] += 1
            dead.append(ws)
    for ws in dead:
        active_sockets.pop(ws, None)
    metrics["connected_clients"] = len(active_sockets)


async def _serve_socket(websocket: WebSocket, token: str, order_filter: str | None = None):
    if not _token_valid(token):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    active_sockets[websocket] = order_filter
    metrics["connected_clients"] = len(active_sockets)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        active_sockets.pop(websocket, None)
        metrics["connected_clients"] = len(active_sockets)


def _consume_status_loop() -> None:
    while worker_state["running"]:
        try:
            connection = pika.BlockingConnection(_rabbit_params())
            channel = connection.channel()
            channel.queue_declare(queue="order.status", durable=True)

            method_frame, _, body = channel.basic_get(queue="order.status", auto_ack=False)
            if method_frame is None:
                connection.close()
                time.sleep(1)
                continue

            try:
                payload = json.loads(body.decode("utf-8"))
                metrics["events_total"] += 1
                if not chaos_state["enabled"] and loop_ref["loop"] is not None:
                    asyncio.run_coroutine_threadsafe(_broadcast(payload), loop_ref["loop"])
                channel.basic_ack(delivery_tag=method_frame.delivery_tag)
            except Exception:
                metrics["push_failures_total"] += 1
                channel.basic_nack(delivery_tag=method_frame.delivery_tag, requeue=True)
            finally:
                connection.close()

        except Exception:
            metrics["push_failures_total"] += 1
            time.sleep(1)


@app.on_event("startup")
async def on_startup():
    loop_ref["loop"] = asyncio.get_running_loop()
    threading.Thread(target=_consume_status_loop, daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    worker_state["running"] = False


@app.get("/health")
def health():
    if chaos_state["enabled"]:
        raise HTTPException(status_code=503, detail="chaos mode enabled")

    try:
        connection = pika.BlockingConnection(_rabbit_params())
        connection.close()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"rabbitmq unavailable: {exc}")

    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    return {
        "events_total": metrics["events_total"],
        "push_failures_total": metrics["push_failures_total"],
        "connected_clients": metrics["connected_clients"],
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.websocket("/ws")
async def ws_status(websocket: WebSocket, token: str = Query(default="")):
    await _serve_socket(websocket, token, order_filter=None)


@app.websocket("/ws/orders/{order_id}")
async def ws_order_status(order_id: str, websocket: WebSocket, token: str = Query(default="")):
    await _serve_socket(websocket, token, order_filter=order_id)
