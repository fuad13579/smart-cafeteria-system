import json
import os
import threading
import time
import uuid
from typing import Any

import httpx
import pika
import psycopg
from fastapi import Cookie, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()
_cors_origins = [x.strip() for x in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

metrics: dict[str, float] = {
    "login_proxy_total": 0,
    "orders_total": 0,
    "orders_failed_total": 0,
    "latency_total_ms": 0,
    "latency_count": 0,
}
latency_samples_ms: list[float] = []
service_started_at = time.time()

chaos_state = {"enabled": False, "mode": "error"}
stock_cache: dict[str, tuple[float, bool]] = {}
stock_cache_lock = threading.Lock()
ACCESS_COOKIE_NAME = os.getenv("ACCESS_COOKIE_NAME", "access_token")


def _stock_cache_ttl_seconds() -> float:
    raw = os.getenv("STOCK_CACHE_TTL_SECONDS", "3")
    try:
        value = float(raw)
        return value if value > 0 else 3.0
    except ValueError:
        return 3.0


def _jwt_exp_minutes() -> int:
    raw = os.getenv("JWT_EXPIRES_MINUTES", "60")
    try:
        value = int(raw)
        return value if value > 0 else 60
    except ValueError:
        return 60


def _cookie_secure() -> bool:
    return os.getenv("COOKIE_SECURE", "false").lower() == "true"


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


def _extract_token(authorization: str | None, cookie_token: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            return token
    if cookie_token and cookie_token.strip():
        return cookie_token.strip()
    return None


def _verify_token(token: str) -> dict | None:
    if not token:
        return None

    try:
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(f"{_identity_url()}/verify", headers={"Authorization": f"Bearer {token}"})
    except Exception:
        raise HTTPException(status_code=503, detail="Identity service unavailable")

    if resp.status_code == 200:
        return resp.json()

    if resp.status_code in {401, 403}:
        return None

    raise HTTPException(status_code=503, detail="Identity verification failed")


def _extract_auth(authorization: str | None, cookie_token: str | None) -> dict | None:
    token = _extract_token(authorization, cookie_token)
    if not token:
        return None
    verified = _verify_token(token)
    if not verified:
        return None
    student_id = verified.get("student_id")
    if not isinstance(student_id, str) or not student_id:
        return None
    return {"student_id": student_id, "role": verified.get("role", "student"), "token": token}


def _fetch_user(student_id: str) -> dict | None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT student_id, full_name, account_balance
                FROM students
                WHERE student_id = %s AND is_active = TRUE
                """,
                (student_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0],
                "student_id": row[0],
                "name": row[1],
                "account_balance": row[2],
            }


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
    _invalidate_stock_cache(item_id)


def _invalidate_stock_cache(item_id: str) -> None:
    with stock_cache_lock:
        stock_cache.pop(item_id, None)


def _is_stock_available_cached(item_id: str) -> bool:
    now = time.time()
    with stock_cache_lock:
        row = stock_cache.get(item_id)
        if row and row[0] > now:
            return row[1]

    try:
        with httpx.Client(timeout=1.0) as client:
            resp = client.get(f"{_stock_url()}/stock/{item_id}")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Stock service unavailable: {exc}") from exc

    if resp.status_code == 404:
        raise HTTPException(status_code=400, detail=f"Item {item_id} not found")
    if resp.status_code >= 500:
        raise HTTPException(status_code=503, detail="Stock service failure")

    body = resp.json()
    is_available = bool(body.get("available", False))
    with stock_cache_lock:
        stock_cache[item_id] = (now + _stock_cache_ttl_seconds(), is_available)
    return is_available


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


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    idx = int(round((pct / 100.0) * (len(sorted_values) - 1)))
    idx = min(max(idx, 0), len(sorted_values) - 1)
    return sorted_values[idx]


def _queue_depth(queue_name: str = "kitchen.jobs") -> int:
    try:
        connection = pika.BlockingConnection(_rabbit_params())
        channel = connection.channel()
        result = channel.queue_declare(queue=queue_name, durable=True, passive=True)
        connection.close()
        return int(result.method.message_count)
    except Exception:
        return -1


def _find_idempotent_order(student_id: str, idempotency_key: str) -> dict[str, Any] | None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.id, o.status, o.eta_minutes, o.total_amount, o.created_at
                FROM order_idempotency oi
                JOIN orders o ON o.id = oi.order_id
                WHERE oi.student_id = %s AND oi.idempotency_key = %s
                """,
                (student_id, idempotency_key),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "order_id": row[0],
                "status": row[1],
                "eta_minutes": row[2],
                "total_amount": row[3],
                "created_at": row[4].isoformat() if row[4] else None,
                "idempotent_replay": True,
            }


def _store_idempotency(student_id: str, idempotency_key: str, order_id: str) -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO order_idempotency(student_id, idempotency_key, order_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (student_id, idempotency_key) DO NOTHING
                """,
                (student_id, idempotency_key, order_id),
            )
            conn.commit()


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


@app.get("/api/admin/metrics")
def get_admin_metrics():
    uptime_minutes = max((time.time() - service_started_at) / 60.0, 1.0 / 60.0)
    return {
        "latency_ms_p50": round(_percentile(latency_samples_ms, 50), 2),
        "latency_ms_p95": round(_percentile(latency_samples_ms, 95), 2),
        "orders_per_min": round(metrics["orders_total"] / uptime_minutes, 2),
        "queue_depth": _queue_depth("kitchen.jobs"),
        "updatedAt": int(time.time()),
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.post("/api/login")
def login(payload: LoginRequest, response: Response):
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
            body = resp.json()
            token = body.get("access_token")
            if isinstance(token, str) and token:
                response.set_cookie(
                    key=ACCESS_COOKIE_NAME,
                    value=token,
                    httponly=True,
                    samesite="lax",
                    secure=_cookie_secure(),
                    max_age=_jwt_exp_minutes() * 60,
                    path="/",
                )
            return body
    except Exception as exc:
        return JSONResponse(status_code=503, content={"message": f"Identity service unavailable: {exc}", "error": "Service Unavailable"})


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response):
    return login(payload, response)


@app.post("/api/refresh")
def refresh(
    response: Response,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    token = _extract_token(authorization, access_token)
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    try:
        with httpx.Client(timeout=5) as client:
            resp = client.post(f"{_identity_url()}/refresh", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code >= 400:
                raise HTTPException(status_code=401, detail="Missing or invalid token")
            body = resp.json()
            refreshed = body.get("access_token")
            if isinstance(refreshed, str) and refreshed:
                response.set_cookie(
                    key=ACCESS_COOKIE_NAME,
                    value=refreshed,
                    httponly=True,
                    samesite="lax",
                    secure=_cookie_secure(),
                    max_age=_jwt_exp_minutes() * 60,
                    path="/",
                )
            return body
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Identity service unavailable: {exc}") from exc


@app.get("/api/auth/me")
def auth_me(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    user = _fetch_user(auth["student_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user["role"] = auth.get("role", "student")
    return {"user": user}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(key=ACCESS_COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/menu")
def get_menu(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

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
def create_order(
    payload: CreateOrderRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    start = time.perf_counter()
    _should_fail()

    if not payload.items:
        metrics["orders_failed_total"] += 1
        return JSONResponse(status_code=400, content={"message": "Order items are required", "error": "Bad Request"})

    auth = _extract_auth(authorization, access_token)
    if not auth:
        metrics["orders_failed_total"] += 1
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    student_id = auth["student_id"]

    key = (idempotency_key or "").strip()
    if key:
        existing = _find_idempotent_order(student_id, key)
        if existing:
            return existing

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

            # Cache-first stock pre-check before reservation call.
            for line in payload.items:
                if not _is_stock_available_cached(line.id):
                    metrics["orders_failed_total"] += 1
                    raise HTTPException(status_code=409, detail=f"Item {line.id} unavailable")

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
    if key:
        _store_idempotency(student_id, key, order_id)

    metrics["orders_total"] += 1
    elapsed_ms = (time.perf_counter() - start) * 1000
    metrics["latency_total_ms"] += elapsed_ms
    metrics["latency_count"] += 1
    latency_samples_ms.append(elapsed_ms)
    if len(latency_samples_ms) > 500:
        del latency_samples_ms[0]

    return {"order_id": order_id, "status": status_value, "eta_minutes": eta_minutes}


@app.get("/api/orders/{order_id}")
def get_order(
    order_id: str,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    if order_id == "me":
        return get_my_orders(authorization=authorization, access_token=access_token)

    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    student_id = auth["student_id"]

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


@app.get("/api/orders/me")
def get_my_orders(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    student_id = auth["student_id"]

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, status, eta_minutes, total_amount, created_at
                FROM orders
                WHERE student_id = %s
                ORDER BY created_at DESC
                """,
                (student_id,),
            )
            rows = cur.fetchall()

    return {
        "orders": [
            {
                "order_id": row[0],
                "status": row[1],
                "eta_minutes": row[2],
                "total_amount": row[3],
                "created_at": row[4].isoformat() if row[4] else None,
            }
            for row in rows
        ]
    }
