import json
import os
import time
import uuid
from typing import Any

import httpx
import pika
import psycopg
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()

metrics: dict[str, float] = {
    "login_proxy_total": 0,
    "orders_total": 0,
    "orders_failed_total": 0,
    "latency_total_ms": 0,
    "latency_count": 0,
}

chaos_state = {"enabled": False, "mode": "error"}


def _db_conn():
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "cafeteria"),
        user=os.getenv("POSTGRES_USER", "cafeteria"),
        password=os.getenv("POSTGRES_PASSWORD", "cafeteria"),
    )


def _identity_url() -> str:
    base = os.getenv("IDENTITY_PROVIDER_URL", "http://identity-provider:8000")
    return base.rstrip("/")


def _stock_url() -> str:
    base = os.getenv("STOCK_SERVICE_URL", "http://stock-service:8000")
    return base.rstrip("/")


def _rabbit_params() -> pika.ConnectionParameters:
    host = os.getenv("RABBITMQ_HOST", "rabbitmq")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    return pika.ConnectionParameters(host=host, port=port)


def _should_fail() -> None:
    if not chaos_state["enabled"]:
        return
    if chaos_state["mode"] == "timeout":
        time.sleep(2)
    raise HTTPException(status_code=503, detail="Service in chaos mode")


class LoginRequest(BaseModel):
    student_id: str
    password: str


class OrderLine(BaseModel):
    id: str
    qty: int = Field(gt=0)


class CreateOrderRequest(BaseModel):
    items: list[OrderLine]


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


def _extract_student_id(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT student_id FROM auth_tokens WHERE token = %s", (token,))
            row = cur.fetchone()
            return row[0] if row else None


def _reserve_item(order_id: str, item_id: str, qty: int) -> None:
    payload = {"order_id": order_id, "item_id": item_id, "qty": qty}
    try:
        with httpx.Client(timeout=1.5) as client:
            resp = client.post(f"{_stock_url()}/stock/reserve", json=payload)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Stock service unavailable: {exc}") from exc

    if resp.status_code == 409:
        detail = resp.json().get("detail", f"Item {item_id} unavailable")
        raise HTTPException(status_code=409, detail=detail)
    if resp.status_code == 404:
        raise HTTPException(status_code=400, detail=f"Item {item_id} not found")
    if resp.status_code >= 500:
        raise HTTPException(status_code=503, detail="Stock service failure")


def _publish_kitchen_job(order: dict[str, Any]) -> None:
    try:
        connection = pika.BlockingConnection(_rabbit_params())
        channel = connection.channel()
        channel.queue_declare(queue="kitchen.jobs", durable=True)
        channel.basic_publish(
            exchange="",
            routing_key="kitchen.jobs",
            body=json.dumps(order),
            properties=pika.BasicProperties(delivery_mode=2),
        )
        connection.close()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Queue unavailable: {exc}") from exc


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
        with httpx.Client(timeout=1.0) as client:
            stock_resp = client.get(f"{_stock_url()}/health")
            if stock_resp.status_code != 200:
                raise RuntimeError("stock health check failed")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"stock unavailable: {exc}")

    try:
        connection = pika.BlockingConnection(_rabbit_params())
        connection.close()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"rabbitmq unavailable: {exc}")

    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    avg_latency = metrics["latency_total_ms"] / metrics["latency_count"] if metrics["latency_count"] else 0
    return {
        "orders_total": metrics["orders_total"],
        "orders_failed_total": metrics["orders_failed_total"],
        "login_proxy_total": metrics["login_proxy_total"],
        "avg_response_latency_ms": round(avg_latency, 2),
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.post("/api/login")
def login(payload: LoginRequest):
    _should_fail()
    metrics["login_proxy_total"] += 1

    url = f"{_identity_url()}/login"
    data = json.dumps(payload.model_dump()).encode("utf-8")

    try:
        with httpx.Client(timeout=5) as client:
            resp = client.post(url, content=data, headers={"Content-Type": "application/json"})
            if resp.status_code >= 400:
                detail = resp.json().get("detail") if resp.headers.get("content-type", "").startswith("application/json") else "Login failed"
                if isinstance(detail, dict):
                    detail = detail.get("message", "Login failed")
                return JSONResponse(status_code=resp.status_code, content={"message": detail or "Login failed", "error": "Unauthorized"})
            return resp.json()
    except Exception as exc:
        return JSONResponse(status_code=503, content={"message": f"Identity service unavailable: {exc}", "error": "Service Unavailable"})


@app.get("/api/menu")
def get_menu():
    _should_fail()

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, price, available
                FROM menu_items
                ORDER BY id
                """
            )
            items = [
                {"id": row[0], "name": row[1], "price": row[2], "available": row[3]}
                for row in cur.fetchall()
            ]

    return {"items": items}


@app.post("/api/orders")
def create_order(payload: CreateOrderRequest, authorization: str | None = Header(default=None)):
    start = time.perf_counter()
    _should_fail()

    if not payload.items:
        metrics["orders_failed_total"] += 1
        return JSONResponse(status_code=400, content={"message": "Order items are required", "error": "Bad Request"})

    student_id = _extract_student_id(authorization)
    if not student_id:
        metrics["orders_failed_total"] += 1
        return JSONResponse(status_code=401, content={"message": "Missing or invalid token", "error": "Unauthorized"})

    ids = list({line.id for line in payload.items})

    with _db_conn() as conn:
        with conn.cursor() as cur:
            placeholders = ",".join(["%s"] * len(ids))
            cur.execute(
                f"SELECT id, name, price, available FROM menu_items WHERE id IN ({placeholders})",
                tuple(ids),
            )
            menu_rows = cur.fetchall()

            menu_map: dict[str, dict[str, Any]] = {
                row[0]: {"id": row[0], "name": row[1], "price": row[2], "available": row[3]}
                for row in menu_rows
            }

            for line in payload.items:
                item = menu_map.get(line.id)
                if not item:
                    metrics["orders_failed_total"] += 1
                    return JSONResponse(status_code=400, content={"message": f"Item {line.id} not found", "error": "Bad Request"})

            order_id = str(uuid.uuid4())
            total = sum(menu_map[line.id]["price"] * line.qty for line in payload.items)

            # Reserve stock before order insert.
            for line in payload.items:
                _reserve_item(order_id=order_id, item_id=line.id, qty=line.qty)

            status_value = "QUEUED"
            eta_minutes = 12

            cur.execute(
                """
                INSERT INTO orders(id, student_id, status, eta_minutes, total_amount)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (order_id, student_id, status_value, eta_minutes, total),
            )

            for line in payload.items:
                unit_price = menu_map[line.id]["price"]
                cur.execute(
                    """
                    INSERT INTO order_items(order_id, item_id, qty, unit_price)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (order_id, line.id, line.qty, unit_price),
                )

            conn.commit()

    _publish_kitchen_job(
        {
            "order_id": order_id,
            "student_id": student_id,
            "status": "QUEUED",
            "eta_minutes": 12,
        }
    )

    metrics["orders_total"] += 1
    elapsed_ms = (time.perf_counter() - start) * 1000
    metrics["latency_total_ms"] += elapsed_ms
    metrics["latency_count"] += 1

    return {"order_id": order_id, "status": status_value, "eta_minutes": eta_minutes}


@app.get("/api/orders/{order_id}")
def get_order(order_id: str, authorization: str | None = Header(default=None)):
    _should_fail()
    student_id = _extract_student_id(authorization)
    if not student_id:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, student_id, status, eta_minutes, total_amount, created_at FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found")
            if row[1] != student_id:
                raise HTTPException(status_code=403, detail="Forbidden")

            return {
                "order_id": row[0],
                "student_id": row[1],
                "status": row[2],
                "eta_minutes": row[3],
                "total_amount": row[4],
                "created_at": row[5].isoformat() if row[5] else None,
            }
