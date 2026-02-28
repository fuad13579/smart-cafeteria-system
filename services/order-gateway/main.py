import json
import os
import threading
import time
import uuid
from datetime import date, datetime, time as dt_time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pika
import psycopg
from fastapi import Cookie, FastAPI, Header, HTTPException, Query, Response
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
    "outbox_published_total": 0,
    "outbox_publish_failed_total": 0,
}
latency_samples_ms: list[float] = []
service_started_at = time.time()

chaos_state = {"enabled": False, "mode": "error"}
stock_cache: dict[str, tuple[float, bool]] = {}
stock_cache_lock = threading.Lock()
outbox_worker_state = {"running": True}
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


def _menu_timezone() -> str:
    return os.getenv("MENU_TIMEZONE", "Asia/Dhaka")


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


def _payment_url() -> str:
    base = os.getenv("PAYMENT_SERVICE_URL", "http://payment-service:8000")
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
    payment_method: str | None = None


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


class AdminMenuCreateRequest(BaseModel):
    id: str | None = None
    name: str
    price: int = Field(ge=0)
    stock_quantity: int = Field(ge=0)
    available: bool = True


class AdminMenuUpdateRequest(BaseModel):
    name: str
    price: int = Field(ge=0)
    stock_quantity: int = Field(ge=0)
    available: bool


class AdminMenuAvailabilityRequest(BaseModel):
    available: bool


class AdminMenuWindowCreateRequest(BaseModel):
    name: str
    start_date: date
    end_date: date
    start_time: dt_time
    end_time: dt_time
    timezone: str = "Asia/Dhaka"
    is_active: bool = True


class AdminMenuWindowUpdateRequest(BaseModel):
    name: str
    start_date: date
    end_date: date
    start_time: dt_time
    end_time: dt_time
    timezone: str
    is_active: bool


class AdminMenuWindowItemsRequest(BaseModel):
    item_ids: list[str]


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


def _require_admin(authorization: str | None, cookie_token: str | None) -> dict[str, Any]:
    auth = _extract_auth(authorization, cookie_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    if auth.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return auth


def _parse_debug_time(debug_value: str | None) -> datetime | None:
    if not debug_value:
        return None
    try:
        parsed = datetime.fromisoformat(debug_value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo(_menu_timezone()))
        return parsed.astimezone(ZoneInfo(_menu_timezone()))
    except Exception:
        return None


def _is_cross_midnight(start: dt_time, end: dt_time) -> bool:
    return start > end


def _time_in_range(now_t: dt_time, start: dt_time, end: dt_time) -> bool:
    if start <= end:
        return start <= now_t < end
    return now_t >= start or now_t < end


def _window_active_for_datetime(
    now_local: datetime,
    start_date: date,
    end_date: date,
    start_time: dt_time,
    end_time: dt_time,
) -> bool:
    now_d = now_local.date()
    now_t = now_local.time()

    if start_time <= end_time:
        if not (start_date <= now_d <= end_date):
            return False
        return _time_in_range(now_t, start_time, end_time)

    # Cross-midnight window:
    # 1) same-day evening segment
    if start_date <= now_d <= end_date and now_t >= start_time:
        return True
    # 2) after-midnight segment belongs to previous date's window
    prev_d = now_d - timedelta(days=1)
    if start_date <= prev_d <= end_date and now_t < end_time:
        return True
    return False


def _next_change_at_for_window(
    now_local: datetime,
    start_date: date,
    end_date: date,
    start_time: dt_time,
    end_time: dt_time,
) -> datetime | None:
    now_d = now_local.date()
    now_t = now_local.time()

    if start_time <= end_time:
        if start_date <= now_d <= end_date and _time_in_range(now_t, start_time, end_time):
            return datetime.combine(now_d, end_time, tzinfo=now_local.tzinfo)
        return None

    # Cross-midnight active on same-day evening.
    if start_date <= now_d <= end_date and now_t >= start_time:
        return datetime.combine(now_d + timedelta(days=1), end_time, tzinfo=now_local.tzinfo)

    # Cross-midnight active on after-midnight segment.
    prev_d = now_d - timedelta(days=1)
    if start_date <= prev_d <= end_date and now_t < end_time:
        return datetime.combine(now_d, end_time, tzinfo=now_local.tzinfo)

    return None


def _resolve_auto_context(now_local: datetime) -> tuple[str, str | None]:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, start_date, end_date, start_time, end_time
                FROM menu_windows
                WHERE is_active = TRUE
                ORDER BY id ASC
                """
            )
            rows = cur.fetchall()

    active_name: str | None = None
    next_change: datetime | None = None
    for row in rows:
        _, name, start_d, end_d, start_t, end_t = row
        if _window_active_for_datetime(now_local, start_d, end_d, start_t, end_t):
            active_name = str(name)
            change_at = _next_change_at_for_window(now_local, start_d, end_d, start_t, end_t)
            if change_at and (next_change is None or change_at < next_change):
                next_change = change_at

    if active_name in {"iftar", "saheri"}:
        return active_name, next_change.isoformat() if next_change else None
    return "regular", next_change.isoformat() if next_change else None


def _get_context_items(context: str, now_local: datetime) -> list[dict[str, Any]]:
    if context == "regular":
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, price, available
                    FROM menu_items
                    ORDER BY id
                    """
                )
                rows = cur.fetchall()
        return [
            {"id": row[0], "name": row[1], "price": int(row[2]), "available": bool(row[3])}
            for row in rows
        ]

    # iftar/saheri by active date range (time-agnostic for explicit context tabs)
    now_d = now_local.date()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT mi.id, mi.name, mi.price, mi.available
                FROM menu_items mi
                JOIN menu_item_windows miw ON miw.item_id = mi.id
                JOIN menu_windows mw ON mw.id = miw.window_id
                WHERE mw.is_active = TRUE
                  AND mw.name = %s
                  AND %s BETWEEN mw.start_date AND mw.end_date
                ORDER BY mi.id
                """,
                (context, now_d),
            )
            rows = cur.fetchall()
    return [
        {"id": row[0], "name": row[1], "price": int(row[2]), "available": bool(row[3])}
        for row in rows
    ]


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


def _publish_queue(queue_name: str, payload: dict[str, Any]) -> None:
    connection = pika.BlockingConnection(_rabbit_params())
    channel = connection.channel()
    channel.queue_declare(queue=queue_name, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=queue_name,
        body=json.dumps(payload),
        properties=pika.BasicProperties(delivery_mode=2),
    )
    connection.close()


def _ensure_outbox_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS event_outbox (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    queue_name TEXT NOT NULL,
                    payload JSONB NOT NULL,
                    published_at TIMESTAMPTZ,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_event_outbox_unpublished_created
                ON event_outbox (created_at)
                WHERE published_at IS NULL
                """
            )
            conn.commit()


def _enqueue_outbox_event(cur: Any, event_type: str, queue_name: str, payload: dict[str, Any]) -> None:
    cur.execute(
        """
        INSERT INTO event_outbox(event_type, queue_name, payload)
        VALUES (%s, %s, %s::jsonb)
        """,
        (event_type, queue_name, json.dumps(payload)),
    )


def _outbox_backlog() -> int:
    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM event_outbox WHERE published_at IS NULL")
                row = cur.fetchone()
                return int(row[0]) if row else 0
    except Exception:
        return -1


def _process_outbox_once(batch_size: int = 25) -> int:
    processed = 0
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, queue_name, payload::text
                FROM event_outbox
                WHERE published_at IS NULL
                ORDER BY created_at ASC
                LIMIT %s
                FOR UPDATE SKIP LOCKED
                """,
                (batch_size,),
            )
            rows = cur.fetchall()
            if not rows:
                conn.commit()
                return 0

            for row in rows:
                outbox_id = int(row[0])
                queue_name = str(row[1])
                payload_raw = row[2]
                try:
                    payload = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
                    _publish_queue(queue_name, payload)
                    cur.execute(
                        """
                        UPDATE event_outbox
                        SET published_at = NOW(), attempts = attempts + 1, last_error = NULL
                        WHERE id = %s
                        """,
                        (outbox_id,),
                    )
                    metrics["outbox_published_total"] += 1
                    processed += 1
                except Exception as exc:
                    cur.execute(
                        """
                        UPDATE event_outbox
                        SET attempts = attempts + 1, last_error = %s
                        WHERE id = %s
                        """,
                        (str(exc)[:400], outbox_id),
                    )
                    metrics["outbox_publish_failed_total"] += 1
            conn.commit()
    return processed


def _outbox_worker_loop() -> None:
    while outbox_worker_state["running"]:
        try:
            processed = _process_outbox_once()
            if processed == 0:
                time.sleep(0.5)
        except Exception:
            metrics["outbox_publish_failed_total"] += 1
            time.sleep(1.0)


def _release_order_reservations(order_id: str) -> None:
    payload = {"order_id": order_id}
    try:
        with httpx.Client(timeout=2.0) as client:
            client.post(f"{_stock_url()}/stock/release", json=payload)
    except Exception:
        pass


def _mark_order_cancelled(order_id: str) -> None:
    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE orders SET status = 'CANCELLED', eta_minutes = 0 WHERE id = %s", (order_id,))
                conn.commit()
    except Exception:
        pass


def _process_payment(order_id: str, student_id: str, amount: int, method: str) -> dict[str, Any]:
    payload = {
        "order_id": order_id,
        "student_id": student_id,
        "amount": amount,
        "currency": "BDT",
        "method": method,
    }
    try:
        with httpx.Client(timeout=4.0) as client:
            resp = client.post(f"{_payment_url()}/payments/process", json=payload)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Payment service unavailable: {exc}") from exc

    if resp.status_code == 200:
        return resp.json()
    if resp.status_code in {404, 409, 422}:
        detail = resp.json().get("detail", "Payment failed")
        raise HTTPException(status_code=409, detail=f"Payment failed: {detail}")
    if resp.status_code >= 500:
        raise HTTPException(status_code=503, detail="Payment service failure")
    raise HTTPException(status_code=502, detail="Unexpected payment response")


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
        "outbox_published_total": metrics["outbox_published_total"],
        "outbox_publish_failed_total": metrics["outbox_publish_failed_total"],
        "outbox_backlog": _outbox_backlog(),
    }


@app.get("/api/admin/metrics")
def get_admin_metrics():
    uptime_minutes = max((time.time() - service_started_at) / 60.0, 1.0 / 60.0)
    return {
        "latency_ms_p50": round(_percentile(latency_samples_ms, 50), 2),
        "latency_ms_p95": round(_percentile(latency_samples_ms, 95), 2),
        "orders_per_min": round(metrics["orders_total"] / uptime_minutes, 2),
        "queue_depth": _queue_depth("kitchen.jobs"),
        "outbox_backlog": _outbox_backlog(),
        "updatedAt": int(time.time()),
    }


@app.on_event("startup")
def on_startup():
    _ensure_outbox_schema()
    threading.Thread(target=_outbox_worker_loop, daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    outbox_worker_state["running"] = False


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.get("/api/admin/menu")
def admin_get_menu(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, price, stock_quantity, available
                FROM menu_items
                ORDER BY id
                """
            )
            rows = cur.fetchall()
    return {
        "items": [
            {
                "id": row[0],
                "name": row[1],
                "price": int(row[2]),
                "stock_quantity": int(row[3]),
                "available": bool(row[4]),
            }
            for row in rows
        ]
    }


@app.post("/api/admin/menu")
def admin_create_menu_item(
    payload: AdminMenuCreateRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    item_id = (payload.id or f"m-{uuid.uuid4().hex[:8]}").strip()
    if not item_id:
        raise HTTPException(status_code=422, detail="id must not be empty")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO menu_items(id, name, price, stock_quantity, available)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, name, price, stock_quantity, available
                """,
                (item_id, payload.name.strip(), payload.price, payload.stock_quantity, payload.available),
            )
            row = cur.fetchone()
            conn.commit()
    return {
        "item": {
            "id": row[0],
            "name": row[1],
            "price": int(row[2]),
            "stock_quantity": int(row[3]),
            "available": bool(row[4]),
        }
    }


@app.put("/api/admin/menu/{item_id}")
def admin_update_menu_item(
    item_id: str,
    payload: AdminMenuUpdateRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE menu_items
                SET name = %s, price = %s, stock_quantity = %s, available = %s
                WHERE id = %s
                RETURNING id, name, price, stock_quantity, available
                """,
                (payload.name.strip(), payload.price, payload.stock_quantity, payload.available, item_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Menu item not found")
            conn.commit()
    _invalidate_stock_cache(item_id)
    return {
        "item": {
            "id": row[0],
            "name": row[1],
            "price": int(row[2]),
            "stock_quantity": int(row[3]),
            "available": bool(row[4]),
        }
    }


@app.patch("/api/admin/menu/{item_id}")
def admin_patch_menu_item_availability(
    item_id: str,
    payload: AdminMenuAvailabilityRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE menu_items
                SET available = %s
                WHERE id = %s
                RETURNING id, name, price, stock_quantity, available
                """,
                (payload.available, item_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Menu item not found")
            conn.commit()
    _invalidate_stock_cache(item_id)
    return {
        "item": {
            "id": row[0],
            "name": row[1],
            "price": int(row[2]),
            "stock_quantity": int(row[3]),
            "available": bool(row[4]),
        }
    }


@app.get("/api/admin/menu/windows")
def admin_get_menu_windows(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT mw.id, mw.name, mw.start_date, mw.end_date, mw.start_time, mw.end_time, mw.timezone, mw.is_active,
                       COALESCE(array_agg(miw.item_id) FILTER (WHERE miw.item_id IS NOT NULL), ARRAY[]::text[]) AS item_ids
                FROM menu_windows mw
                LEFT JOIN menu_item_windows miw ON miw.window_id = mw.id
                GROUP BY mw.id
                ORDER BY mw.id
                """
            )
            rows = cur.fetchall()
    return {
        "windows": [
            {
                "id": int(row[0]),
                "name": row[1],
                "start_date": row[2].isoformat(),
                "end_date": row[3].isoformat(),
                "start_time": row[4].isoformat(),
                "end_time": row[5].isoformat(),
                "timezone": row[6],
                "is_active": bool(row[7]),
                "item_ids": list(row[8] or []),
            }
            for row in rows
        ]
    }


@app.post("/api/admin/menu/windows")
def admin_create_menu_window(
    payload: AdminMenuWindowCreateRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)
    if payload.name not in {"iftar", "saheri"}:
        raise HTTPException(status_code=422, detail="name must be iftar|saheri")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO menu_windows(name, start_date, end_date, start_time, end_time, timezone, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, name, start_date, end_date, start_time, end_time, timezone, is_active
                """,
                (
                    payload.name,
                    payload.start_date,
                    payload.end_date,
                    payload.start_time,
                    payload.end_time,
                    payload.timezone,
                    payload.is_active,
                ),
            )
            row = cur.fetchone()
            conn.commit()
    return {
        "window": {
            "id": int(row[0]),
            "name": row[1],
            "start_date": row[2].isoformat(),
            "end_date": row[3].isoformat(),
            "start_time": row[4].isoformat(),
            "end_time": row[5].isoformat(),
            "timezone": row[6],
            "is_active": bool(row[7]),
            "item_ids": [],
        }
    }


@app.put("/api/admin/menu/windows/{window_id}")
def admin_update_menu_window(
    window_id: int,
    payload: AdminMenuWindowUpdateRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)
    if payload.name not in {"iftar", "saheri"}:
        raise HTTPException(status_code=422, detail="name must be iftar|saheri")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE menu_windows
                SET name = %s, start_date = %s, end_date = %s, start_time = %s, end_time = %s, timezone = %s, is_active = %s
                WHERE id = %s
                RETURNING id, name, start_date, end_date, start_time, end_time, timezone, is_active
                """,
                (
                    payload.name,
                    payload.start_date,
                    payload.end_date,
                    payload.start_time,
                    payload.end_time,
                    payload.timezone,
                    payload.is_active,
                    window_id,
                ),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Window not found")
            conn.commit()
    return {
        "window": {
            "id": int(row[0]),
            "name": row[1],
            "start_date": row[2].isoformat(),
            "end_date": row[3].isoformat(),
            "start_time": row[4].isoformat(),
            "end_time": row[5].isoformat(),
            "timezone": row[6],
            "is_active": bool(row[7]),
        }
    }


@app.delete("/api/admin/menu/windows/{window_id}")
def admin_delete_menu_window(
    window_id: int,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM menu_windows WHERE id = %s", (window_id,))
            deleted = cur.rowcount
            conn.commit()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Window not found")
    return {"ok": True, "window_id": window_id}


@app.post("/api/admin/menu/windows/{window_id}/items")
def admin_assign_window_items(
    window_id: int,
    payload: AdminMenuWindowItemsRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    clean_ids = [item_id.strip() for item_id in payload.item_ids if item_id.strip()]
    unique_ids = sorted(set(clean_ids))

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM menu_windows WHERE id = %s", (window_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Window not found")

            if unique_ids:
                placeholders = ",".join(["%s"] * len(unique_ids))
                cur.execute(f"SELECT id FROM menu_items WHERE id IN ({placeholders})", tuple(unique_ids))
                found = {row[0] for row in cur.fetchall()}
                missing = [x for x in unique_ids if x not in found]
                if missing:
                    raise HTTPException(status_code=404, detail=f"Menu item(s) not found: {', '.join(missing)}")

            cur.execute("DELETE FROM menu_item_windows WHERE window_id = %s", (window_id,))
            for item_id in unique_ids:
                cur.execute(
                    """
                    INSERT INTO menu_item_windows(window_id, item_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (window_id, item_id),
                )
            conn.commit()
    return {"ok": True, "window_id": window_id, "item_ids": unique_ids}


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
    context: str = Query(default="auto"),
    x_debug_time: str | None = Header(default=None, alias="X-Debug-Time"),
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    requested = (context or "auto").strip().lower()
    if requested not in {"auto", "regular", "iftar", "saheri"}:
        raise HTTPException(status_code=422, detail="context must be auto|regular|iftar|saheri")

    now_local = _parse_debug_time(x_debug_time) or datetime.now(ZoneInfo(_menu_timezone()))

    if requested == "auto":
        active_context, next_change_at = _resolve_auto_context(now_local)
        items = _get_context_items(active_context, now_local)
    else:
        active_context = requested
        next_change_at = None
        items = _get_context_items(active_context, now_local)

    return {
        "active_context": active_context,
        "next_change_at": next_change_at,
        "items": items,
    }


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
    order_id = str(uuid.uuid4())
    status_value = "QUEUED"
    eta_minutes = 12
    reservations_done = False
    total_amount = 0
    payment_method = (payload.payment_method or "CASH").strip().upper()

    try:
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

                total = sum(menu_map[line.id]["price"] * line.qty for line in payload.items)
                total_amount = total

                # Cache-first stock pre-check before reservation call.
                for line in payload.items:
                    if not _is_stock_available_cached(line.id):
                        metrics["orders_failed_total"] += 1
                        raise HTTPException(status_code=409, detail=f"Item {line.id} unavailable")

                # Reserve stock before order insert.
                for line in payload.items:
                    _reserve_item(order_id=order_id, item_id=line.id, qty=line.qty)
                reservations_done = True

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
    except Exception:
        if reservations_done:
            _release_order_reservations(order_id)
        raise

    try:
        _process_payment(
            order_id=order_id,
            student_id=student_id,
            amount=total_amount,
            method=payment_method,
        )
    except Exception:
        _mark_order_cancelled(order_id)
        if reservations_done:
            _release_order_reservations(order_id)
        raise

    with _db_conn() as conn:
        with conn.cursor() as cur:
            _enqueue_outbox_event(
                cur=cur,
                event_type="order.created",
                queue_name="kitchen.jobs",
                payload={
                    "order_id": order_id,
                    "student_id": student_id,
                    "status": status_value,
                    "eta_minutes": eta_minutes,
                },
            )
            conn.commit()

    if key:
        _store_idempotency(student_id, key, order_id)

    metrics["orders_total"] += 1
    elapsed_ms = (time.perf_counter() - start) * 1000
    metrics["latency_total_ms"] += elapsed_ms
    metrics["latency_count"] += 1
    latency_samples_ms.append(elapsed_ms)
    if len(latency_samples_ms) > 500:
        del latency_samples_ms[0]

    return {
        "order_id": order_id,
        "status": status_value,
        "eta_minutes": eta_minutes,
        "payment_status": "COMPLETED",
    }


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
