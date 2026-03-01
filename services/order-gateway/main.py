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
import redis
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
outbox_worker_state = {"running": True}
cache_worker_state = {"running": True}
ACCESS_COOKIE_NAME = os.getenv("ACCESS_COOKIE_NAME", "access_token")
redis_client: redis.Redis | None = None


def _stock_cache_ttl_seconds() -> int:
    raw = os.getenv("STOCK_CACHE_TTL_SECONDS", "3")
    try:
        value = int(float(raw))
        return value if value > 0 else 3
    except ValueError:
        return 3


def _menu_cache_ttl_seconds() -> int:
    raw = os.getenv("MENU_CACHE_TTL_SECONDS", "60")
    try:
        value = int(raw)
        return value if value > 0 else 60
    except ValueError:
        return 60


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


def _redis_url() -> str:
    return os.getenv("REDIS_URL", "redis://redis:6379/0")


def _init_redis() -> None:
    global redis_client
    try:
        client = redis.Redis.from_url(_redis_url(), decode_responses=True)
        client.ping()
        redis_client = client
    except Exception:
        redis_client = None


def _close_redis() -> None:
    global redis_client
    if redis_client is not None:
        try:
            redis_client.close()
        except Exception:
            pass
    redis_client = None


def _cache_get_json(key: str) -> Any | None:
    if redis_client is None:
        return None
    try:
        raw = redis_client.get(key)
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None


def _cache_set_json(key: str, data: Any, ttl_seconds: int) -> None:
    if redis_client is None:
        return
    try:
        redis_client.setex(key, ttl_seconds, json.dumps(data, default=str))
    except Exception:
        pass


def _cache_get_text(key: str) -> str | None:
    if redis_client is None:
        return None
    try:
        return redis_client.get(key)
    except Exception:
        return None


def _cache_set_text(key: str, value: str, ttl_seconds: int) -> None:
    if redis_client is None:
        return
    try:
        redis_client.setex(key, ttl_seconds, value)
    except Exception:
        pass


def _cache_del_key(key: str) -> None:
    if redis_client is None:
        return
    try:
        redis_client.delete(key)
    except Exception:
        pass


def _cache_del_pattern(pattern: str) -> None:
    if redis_client is None:
        return
    try:
        keys = list(redis_client.scan_iter(match=pattern, count=100))
        if keys:
            redis_client.delete(*keys)
    except Exception:
        pass


def _stock_zero_cache_key(item_id: str) -> str:
    return f"stock:zero:{item_id}:v1"


def _menu_cache_key(context: str) -> str:
    return f"menu:{context}:v1"


MAIN_SLOT_MAP: dict[str, tuple[str, ...]] = {
    "regular": ("breakfast", "lunch", "dinner"),
    "ramadan": ("iftar", "suhoor"),
}


def _default_slot_for_main(main: str) -> str:
    return "breakfast" if main == "regular" else "iftar"


def _is_valid_main_slot(main: str, slot: str) -> bool:
    return main in MAIN_SLOT_MAP and slot in MAIN_SLOT_MAP[main]


def _menu_cache_key_for_slot(main: str, slot: str) -> str:
    return f"menu:{main}:{slot}:v1"


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


class AdminMenuSlotItemsRequest(BaseModel):
    item_ids: list[str]


class AdminRamadanVisibilityUpdateRequest(BaseModel):
    enabled: bool
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: str = "Asia/Dhaka"


class WalletTopupRequest(BaseModel):
    amount: int = Field(gt=0, le=50000)
    method: str


class WalletWebhookRequest(BaseModel):
    topup_id: str
    status: str
    provider_txn_id: str | None = None


class AdminTopupReviewRequest(BaseModel):
    action: str


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


def _ensure_menu_slot_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS menu_slots (
                    id BIGSERIAL PRIMARY KEY,
                    main TEXT NOT NULL CHECK (main IN ('regular', 'ramadan')),
                    slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'iftar', 'suhoor')),
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (main, slot),
                    CHECK (
                        (main = 'regular' AND slot IN ('breakfast', 'lunch', 'dinner'))
                        OR
                        (main = 'ramadan' AND slot IN ('iftar', 'suhoor'))
                    )
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS menu_item_slots (
                    slot_id BIGINT NOT NULL REFERENCES menu_slots(id) ON DELETE CASCADE,
                    item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (slot_id, item_id)
                )
                """
            )
            cur.execute(
                """
                INSERT INTO menu_slots(main, slot, is_active)
                VALUES
                    ('regular', 'breakfast', TRUE),
                    ('regular', 'lunch', TRUE),
                    ('regular', 'dinner', TRUE),
                    ('ramadan', 'iftar', TRUE),
                    ('ramadan', 'suhoor', TRUE)
                ON CONFLICT (main, slot) DO NOTHING
                """
            )
            cur.execute(
                """
                INSERT INTO menu_item_slots(slot_id, item_id)
                SELECT ms.id, mi.id
                FROM menu_slots ms
                CROSS JOIN menu_items mi
                WHERE NOT EXISTS (
                    SELECT 1 FROM menu_item_slots mis WHERE mis.slot_id = ms.id
                )
                ON CONFLICT DO NOTHING
                """
            )
            conn.commit()


def _ensure_ramadan_visibility_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS menu_visibility_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    ramadan_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                    ramadan_start_at TIMESTAMPTZ,
                    ramadan_end_at TIMESTAMPTZ,
                    timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                INSERT INTO menu_visibility_settings(id, ramadan_enabled, timezone)
                VALUES (1, TRUE, 'Asia/Dhaka')
                ON CONFLICT (id) DO NOTHING
                """
            )
            conn.commit()


def _get_ramadan_visibility(now_local: datetime) -> dict[str, Any]:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ramadan_enabled, ramadan_start_at, ramadan_end_at, timezone
                FROM menu_visibility_settings
                WHERE id = 1
                """
            )
            row = cur.fetchone()
            if not row:
                return {"visible": True, "enabled": True, "start_at": None, "end_at": None, "timezone": "Asia/Dhaka"}
            enabled = bool(row[0])
            start_at = row[1]
            end_at = row[2]
            timezone = str(row[3] or "Asia/Dhaka")

    visible = enabled
    if visible and start_at is not None:
        visible = now_local.astimezone(start_at.tzinfo) >= start_at
    if visible and end_at is not None:
        visible = now_local.astimezone(end_at.tzinfo) <= end_at

    return {
        "visible": visible,
        "enabled": enabled,
        "start_at": start_at.isoformat() if start_at else None,
        "end_at": end_at.isoformat() if end_at else None,
        "timezone": timezone,
    }


def _resolve_main_slot_from_legacy_context(context: str, now_local: datetime) -> tuple[str, str]:
    ctx = (context or "").strip().lower()
    if ctx in {"", "auto"}:
        active_context, _ = _resolve_auto_context(now_local)
        if active_context == "regular":
            return "regular", "lunch"
        if active_context == "iftar":
            return "ramadan", "iftar"
        return "ramadan", "suhoor"
    if ctx == "regular":
        return "regular", "lunch"
    if ctx == "iftar":
        return "ramadan", "iftar"
    if ctx == "saheri":
        return "ramadan", "suhoor"
    raise HTTPException(status_code=422, detail="context must be auto|regular|iftar|saheri")


def _next_change_at_for_menu_slot(main: str, slot: str, now_local: datetime) -> str | None:
    if main != "ramadan":
        return None
    window_name = "iftar" if slot == "iftar" else "saheri"
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT start_date, end_date, start_time, end_time
                FROM menu_windows
                WHERE is_active = TRUE AND name = %s
                ORDER BY id ASC
                """,
                (window_name,),
            )
            rows = cur.fetchall()

    next_change: datetime | None = None
    for start_d, end_d, start_t, end_t in rows:
        if _window_active_for_datetime(now_local, start_d, end_d, start_t, end_t):
            change_at = _next_change_at_for_window(now_local, start_d, end_d, start_t, end_t)
            if change_at and (next_change is None or change_at < next_change):
                next_change = change_at
    return next_change.isoformat() if next_change else None


def _get_slot_items(main: str, slot: str) -> list[dict[str, Any]]:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT mi.id, mi.name, mi.price, mi.available, mi.stock_quantity
                FROM menu_items mi
                JOIN menu_item_slots mis ON mis.item_id = mi.id
                JOIN menu_slots ms ON ms.id = mis.slot_id
                WHERE ms.main = %s AND ms.slot = %s AND ms.is_active = TRUE
                ORDER BY mi.id
                """,
                (main, slot),
            )
            rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "name": row[1],
            "price": int(row[2]),
            "available": bool(row[3]),
            "stock_quantity": int(row[4]),
        }
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
    _cache_del_key(_stock_zero_cache_key(item_id))


def _is_stock_available_cached(item_id: str) -> bool:
    # Fast reject using short-lived negative cache.
    if _cache_get_text(_stock_zero_cache_key(item_id)) == "1":
        return False

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
    stock_quantity = int(body.get("stock_quantity", 0))
    if not is_available or stock_quantity <= 0:
        _cache_set_text(_stock_zero_cache_key(item_id), "1", _stock_cache_ttl_seconds())
        return False

    _cache_del_key(_stock_zero_cache_key(item_id))
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


def _publish_cache_invalidation(event: str, item_id: str | None = None) -> None:
    payload: dict[str, Any] = {"event": event, "ts": int(time.time())}
    if item_id:
        payload["item_id"] = item_id
    try:
        _publish_queue("cache.invalidate", payload)
    except Exception:
        # Best effort: cache is an optimization, not correctness source.
        pass


def _process_cache_event(event: dict[str, Any]) -> None:
    event_name = str(event.get("event", "")).strip().lower()
    if event_name == "menu.updated":
        _cache_del_pattern("menu:*")
        return
    if event_name == "stock.changed":
        item_id = str(event.get("item_id", "")).strip()
        if item_id:
            _cache_del_key(_stock_zero_cache_key(item_id))


def _cache_invalidator_loop() -> None:
    while cache_worker_state["running"]:
        try:
            connection = pika.BlockingConnection(_rabbit_params())
            channel = connection.channel()
            channel.queue_declare(queue="cache.invalidate", durable=True)
            for method, _, body in channel.consume("cache.invalidate", inactivity_timeout=1.0):
                if not cache_worker_state["running"]:
                    break
                if method is None:
                    continue
                try:
                    payload = json.loads(body.decode("utf-8")) if isinstance(body, (bytes, bytearray)) else {}
                    if isinstance(payload, dict):
                        _process_cache_event(payload)
                finally:
                    channel.basic_ack(method.delivery_tag)
            channel.cancel()
            connection.close()
        except Exception:
            time.sleep(1.0)


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


def _ensure_wallet_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS wallet_topups (
                    id BIGSERIAL PRIMARY KEY,
                    topup_id TEXT NOT NULL UNIQUE,
                    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
                    amount INTEGER NOT NULL CHECK (amount > 0),
                    method TEXT NOT NULL CHECK (method IN ('BANK', 'BKASH', 'NAGAD')),
                    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
                    provider_ref TEXT,
                    idempotency_key TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMPTZ
                )
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topups_student_key
                ON wallet_topups(student_id, idempotency_key)
                WHERE idempotency_key IS NOT NULL
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS wallet_transactions (
                    id BIGSERIAL PRIMARY KEY,
                    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
                    txn_type TEXT NOT NULL CHECK (txn_type IN ('TOPUP', 'ORDER_PAYMENT', 'ADJUSTMENT')),
                    direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
                    amount INTEGER NOT NULL CHECK (amount > 0),
                    balance_before INTEGER NOT NULL CHECK (balance_before >= 0),
                    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
                    reference_type TEXT NOT NULL,
                    reference_id TEXT NOT NULL,
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_wallet_transactions_student_created
                ON wallet_transactions(student_id, created_at DESC)
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


def _complete_topup(cur: Any, topup_id: str, provider_ref: str | None = None) -> tuple[bool, dict[str, Any]]:
    cur.execute(
        """
        SELECT topup_id, student_id, amount, method, status, COALESCE(provider_ref, '')
        FROM wallet_topups
        WHERE topup_id = %s
        FOR UPDATE
        """,
        (topup_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up not found")

    topup = {
        "topup_id": row[0],
        "student_id": row[1],
        "amount": int(row[2]),
        "method": str(row[3]),
        "status": str(row[4]),
        "provider_ref": str(row[5] or ""),
    }
    if topup["status"] == "COMPLETED":
        return True, topup
    if topup["status"] == "FAILED":
        raise HTTPException(status_code=409, detail="Top-up already failed")

    cur.execute(
        """
        SELECT account_balance
        FROM students
        WHERE student_id = %s AND is_active = TRUE
        FOR UPDATE
        """,
        (topup["student_id"],),
    )
    bal_row = cur.fetchone()
    if not bal_row:
        raise HTTPException(status_code=404, detail="Student not found")
    before = int(bal_row[0])
    after = before + topup["amount"]

    final_provider_ref = (provider_ref or topup["provider_ref"] or f"{topup['method']}-{uuid.uuid4().hex[:10]}").strip()

    cur.execute(
        """
        UPDATE students
        SET account_balance = %s
        WHERE student_id = %s
        """,
        (after, topup["student_id"]),
    )
    cur.execute(
        """
        UPDATE wallet_topups
        SET status = 'COMPLETED', provider_ref = %s, completed_at = NOW()
        WHERE topup_id = %s
        """,
        (final_provider_ref, topup_id),
    )
    cur.execute(
        """
        INSERT INTO wallet_transactions (
            student_id, txn_type, direction, amount, balance_before, balance_after, reference_type, reference_id, metadata
        )
        VALUES (%s, 'TOPUP', 'CREDIT', %s, %s, %s, 'topup', %s, %s::jsonb)
        """,
        (
            topup["student_id"],
            topup["amount"],
            before,
            after,
            topup_id,
            json.dumps({"method": topup["method"], "provider_ref": final_provider_ref}),
        ),
    )

    topup["status"] = "COMPLETED"
    topup["provider_ref"] = final_provider_ref
    topup["account_balance"] = after
    return False, topup


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
    _init_redis()
    _ensure_outbox_schema()
    _ensure_wallet_schema()
    _ensure_menu_slot_schema()
    _ensure_ramadan_visibility_schema()
    threading.Thread(target=_outbox_worker_loop, daemon=True).start()
    threading.Thread(target=_cache_invalidator_loop, daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    outbox_worker_state["running"] = False
    cache_worker_state["running"] = False
    _close_redis()


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


@app.get("/api/admin/menu/slots")
def admin_get_menu_slots(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ms.id, ms.main, ms.slot, ms.is_active,
                       COALESCE(array_agg(mis.item_id) FILTER (WHERE mis.item_id IS NOT NULL), ARRAY[]::text[]) AS item_ids
                FROM menu_slots ms
                LEFT JOIN menu_item_slots mis ON mis.slot_id = ms.id
                GROUP BY ms.id
                ORDER BY ms.main, ms.slot
                """
            )
            rows = cur.fetchall()
    return {
        "slots": [
            {
                "id": int(row[0]),
                "main": row[1],
                "slot": row[2],
                "is_active": bool(row[3]),
                "item_ids": list(row[4] or []),
            }
            for row in rows
        ]
    }


@app.post("/api/admin/menu/slots/{main}/{slot}/items")
def admin_assign_menu_slot_items(
    main: str,
    slot: str,
    payload: AdminMenuSlotItemsRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)
    main_norm = main.strip().lower()
    slot_norm = slot.strip().lower()
    if not _is_valid_main_slot(main_norm, slot_norm):
        raise HTTPException(status_code=422, detail="Invalid main/slot combination")

    clean_ids = [item_id.strip() for item_id in payload.item_ids if item_id.strip()]
    unique_ids = sorted(set(clean_ids))

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM menu_slots WHERE main = %s AND slot = %s", (main_norm, slot_norm))
            slot_row = cur.fetchone()
            if not slot_row:
                raise HTTPException(status_code=404, detail="Menu slot not found")
            slot_id = int(slot_row[0])

            if unique_ids:
                placeholders = ",".join(["%s"] * len(unique_ids))
                cur.execute(f"SELECT id FROM menu_items WHERE id IN ({placeholders})", tuple(unique_ids))
                found = {row[0] for row in cur.fetchall()}
                missing = [x for x in unique_ids if x not in found]
                if missing:
                    raise HTTPException(status_code=404, detail=f"Menu item(s) not found: {', '.join(missing)}")

            cur.execute("DELETE FROM menu_item_slots WHERE slot_id = %s", (slot_id,))
            for item_id in unique_ids:
                cur.execute(
                    """
                    INSERT INTO menu_item_slots(slot_id, item_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (slot_id, item_id),
                )
            conn.commit()
    _publish_cache_invalidation("menu.updated")
    return {"ok": True, "main": main_norm, "slot": slot_norm, "item_ids": unique_ids}


@app.get("/api/admin/menu/visibility")
def admin_get_menu_visibility(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)
    now_local = datetime.now(ZoneInfo(_menu_timezone()))
    data = _get_ramadan_visibility(now_local)
    return {
        "ramadan": {
            "visible_now": data["visible"],
            "enabled": data["enabled"],
            "start_at": data["start_at"],
            "end_at": data["end_at"],
            "timezone": data["timezone"],
        }
    }


@app.put("/api/admin/menu/visibility")
def admin_update_menu_visibility(
    payload: AdminRamadanVisibilityUpdateRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    _require_admin(authorization, access_token)
    if payload.start_at and payload.end_at and payload.start_at >= payload.end_at:
        raise HTTPException(status_code=422, detail="start_at must be before end_at")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE menu_visibility_settings
                SET ramadan_enabled = %s,
                    ramadan_start_at = %s,
                    ramadan_end_at = %s,
                    timezone = %s,
                    updated_at = NOW()
                WHERE id = 1
                """,
                (payload.enabled, payload.start_at, payload.end_at, payload.timezone.strip() or "Asia/Dhaka"),
            )
            conn.commit()
    _publish_cache_invalidation("menu.updated")
    now_local = datetime.now(ZoneInfo(_menu_timezone()))
    data = _get_ramadan_visibility(now_local)
    return {
        "ok": True,
        "ramadan": {
            "visible_now": data["visible"],
            "enabled": data["enabled"],
            "start_at": data["start_at"],
            "end_at": data["end_at"],
            "timezone": data["timezone"],
        },
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
    _publish_cache_invalidation("menu.updated", item_id=item_id)
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
    _publish_cache_invalidation("menu.updated", item_id=item_id)
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
    _publish_cache_invalidation("menu.updated", item_id=item_id)
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
    _publish_cache_invalidation("menu.updated")
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
    _publish_cache_invalidation("menu.updated")
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
    _publish_cache_invalidation("menu.updated")
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
    _publish_cache_invalidation("menu.updated")
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


@app.get("/api/wallet/balance")
def wallet_balance(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT account_balance
                FROM students
                WHERE student_id = %s AND is_active = TRUE
                """,
                (auth["student_id"],),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Student not found")
            return {"student_id": auth["student_id"], "account_balance": int(row[0])}


@app.get("/api/wallet")
def wallet_get(
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    return wallet_balance(authorization=authorization, access_token=access_token)


@app.get("/api/wallet/transactions")
def wallet_transactions(
    status: str = Query(default="all"),
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    normalized = status.strip().lower()
    status_map = {
        "all": None,
        "success": "COMPLETED",
        "pending": "PENDING",
        "failed": "FAILED",
    }
    if normalized not in status_map:
        raise HTTPException(status_code=422, detail="status must be all|success|pending|failed")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            if status_map[normalized] is None:
                cur.execute(
                    """
                    SELECT topup_id, method, amount, status, provider_ref, created_at, completed_at
                    FROM wallet_topups
                    WHERE student_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (auth["student_id"], limit),
                )
            else:
                cur.execute(
                    """
                    SELECT topup_id, method, amount, status, provider_ref, created_at, completed_at
                    FROM wallet_topups
                    WHERE student_id = %s AND status = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (auth["student_id"], status_map[normalized], limit),
                )
            rows = cur.fetchall()

    txns: list[dict[str, Any]] = []
    for row in rows:
        topup_status = str(row[3]).upper()
        ui_status = "Success" if topup_status == "COMPLETED" else ("Pending" if topup_status == "PENDING" else "Failed")
        txns.append(
            {
                "transaction_id": row[0],
                "topup_id": row[0],
                "method": row[1],
                "amount": int(row[2]),
                "status": ui_status,
                "provider_ref": row[4] or None,
                "created_at": row[5].isoformat() if row[5] else None,
                "completed_at": row[6].isoformat() if row[6] else None,
            }
        )

    return {"transactions": txns}


@app.post("/api/wallet/topups")
def wallet_topup(
    payload: WalletTopupRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    _should_fail()
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    method = payload.method.strip().upper()
    if method not in {"BANK", "BKASH", "NAGAD"}:
        raise HTTPException(status_code=422, detail="method must be BANK, BKASH, or NAGAD")

    student_id = auth["student_id"]
    key = (idempotency_key or "").strip() or None
    topup_id = f"topup-{uuid.uuid4().hex[:12]}"
    reference_id = f"REF-{uuid.uuid4().hex[:10].upper()}"
    redirect_url = f"https://pay.local/{method.lower()}/{topup_id}" if method in {"BKASH", "NAGAD"} else None

    with _db_conn() as conn:
        with conn.cursor() as cur:
            if key:
                cur.execute(
                    """
                    SELECT topup_id, amount, method, status, provider_ref
                    FROM wallet_topups
                    WHERE student_id = %s AND idempotency_key = %s
                    """,
                    (student_id, key),
                )
                replay = cur.fetchone()
                if replay:
                    return {
                        "ok": True,
                        "replayed": True,
                        "topup": {
                            "topup_id": replay[0],
                            "amount": int(replay[1]),
                            "method": replay[2],
                            "status": replay[3],
                            "reference_id": replay[4] or reference_id,
                            "redirect_url": redirect_url,
                        },
                    }

            cur.execute(
                """
                SELECT student_id
                FROM students
                WHERE student_id = %s AND is_active = TRUE
                """,
                (student_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Student not found")

            cur.execute(
                """
                INSERT INTO wallet_topups (
                    topup_id, student_id, amount, method, status, provider_ref, idempotency_key
                )
                VALUES (%s, %s, %s, %s, 'PENDING', %s, %s)
                """,
                (topup_id, student_id, payload.amount, method, reference_id, key),
            )
            conn.commit()

    return {
        "ok": True,
        "replayed": False,
        "topup": {
            "topup_id": topup_id,
            "amount": payload.amount,
            "method": method,
            "status": "PENDING",
            "reference_id": reference_id,
            "redirect_url": redirect_url,
        },
    }


@app.post("/api/wallet/webhook/{provider}")
def wallet_webhook(
    provider: str,
    payload: WalletWebhookRequest,
):
    provider_name = provider.strip().lower()
    if provider_name not in {"bkash", "nagad", "bank"}:
        raise HTTPException(status_code=422, detail="provider must be bkash|nagad|bank")

    incoming_status = payload.status.strip().upper()
    if incoming_status not in {"SUCCESS", "FAILED"}:
        raise HTTPException(status_code=422, detail="status must be SUCCESS or FAILED")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT topup_id, method, status
                FROM wallet_topups
                WHERE topup_id = %s
                FOR UPDATE
                """,
                (payload.topup_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Top-up not found")
            if str(row[1]).strip().lower() != provider_name:
                raise HTTPException(status_code=409, detail="Provider mismatch for top-up")
            current_status = str(row[2]).upper()

            if current_status == "COMPLETED":
                conn.commit()
                return {"ok": True, "already_processed": True, "topup_id": payload.topup_id, "status": "SUCCESS"}
            if current_status == "FAILED":
                conn.commit()
                return {"ok": True, "already_processed": True, "topup_id": payload.topup_id, "status": "FAILED"}

            if incoming_status == "FAILED":
                cur.execute(
                    """
                    UPDATE wallet_topups
                    SET status = 'FAILED', provider_ref = COALESCE(%s, provider_ref), completed_at = NOW()
                    WHERE topup_id = %s
                    """,
                    (payload.provider_txn_id, payload.topup_id),
                )
                conn.commit()
                return {"ok": True, "already_processed": False, "topup_id": payload.topup_id, "status": "FAILED"}

            replayed, topup = _complete_topup(cur, payload.topup_id, provider_ref=payload.provider_txn_id)
            conn.commit()

    return {
        "ok": True,
        "already_processed": replayed,
        "topup_id": payload.topup_id,
        "status": "SUCCESS",
        "account_balance": topup.get("account_balance"),
    }


@app.get("/api/admin/wallet/topups")
def admin_wallet_topups(
    status: str = Query(default="pending"),
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _require_admin(authorization, access_token)
    normalized = status.strip().lower()
    status_map = {"all": None, "pending": "PENDING", "success": "COMPLETED", "failed": "FAILED"}
    if normalized not in status_map:
        raise HTTPException(status_code=422, detail="status must be all|pending|success|failed")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            if status_map[normalized] is None:
                cur.execute(
                    """
                    SELECT topup_id, student_id, amount, method, status, provider_ref, created_at, completed_at
                    FROM wallet_topups
                    ORDER BY created_at DESC
                    LIMIT 200
                    """
                )
            else:
                cur.execute(
                    """
                    SELECT topup_id, student_id, amount, method, status, provider_ref, created_at, completed_at
                    FROM wallet_topups
                    WHERE status = %s
                    ORDER BY created_at DESC
                    LIMIT 200
                    """,
                    (status_map[normalized],),
                )
            rows = cur.fetchall()

    return {
        "topups": [
            {
                "topup_id": row[0],
                "student_id": row[1],
                "amount": int(row[2]),
                "method": row[3],
                "status": row[4],
                "reference_id": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
                "completed_at": row[7].isoformat() if row[7] else None,
            }
            for row in rows
        ]
    }


@app.post("/api/admin/wallet/topups/{topup_id}/review")
def admin_review_topup(
    topup_id: str,
    payload: AdminTopupReviewRequest,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _require_admin(authorization, access_token)
    action = payload.action.strip().lower()
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=422, detail="action must be approve|reject")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status
                FROM wallet_topups
                WHERE topup_id = %s
                FOR UPDATE
                """,
                (topup_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Top-up not found")
            current_status = str(row[0]).upper()

            if current_status == "COMPLETED":
                conn.commit()
                return {"ok": True, "already_processed": True, "topup_id": topup_id, "status": "SUCCESS"}
            if current_status == "FAILED":
                conn.commit()
                return {"ok": True, "already_processed": True, "topup_id": topup_id, "status": "FAILED"}

            if action == "reject":
                cur.execute(
                    "UPDATE wallet_topups SET status = 'FAILED', completed_at = NOW() WHERE topup_id = %s",
                    (topup_id,),
                )
                conn.commit()
                return {"ok": True, "already_processed": False, "topup_id": topup_id, "status": "FAILED"}

            replayed, topup = _complete_topup(cur, topup_id)
            conn.commit()

    return {
        "ok": True,
        "already_processed": replayed,
        "topup_id": topup_id,
        "status": "SUCCESS",
        "account_balance": topup.get("account_balance"),
    }


@app.get("/api/menu")
def get_menu(
    main: str | None = Query(default=None),
    slot: str | None = Query(default=None),
    context: str | None = Query(default=None),
    x_debug_time: str | None = Header(default=None, alias="X-Debug-Time"),
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    now_local = _parse_debug_time(x_debug_time) or datetime.now(ZoneInfo(_menu_timezone()))

    requested_main = (main or "").strip().lower()
    requested_slot = (slot or "").strip().lower()

    # Backward-compatible path for old clients using context=auto|regular|iftar|saheri.
    if not requested_main and not requested_slot:
        requested_main, requested_slot = _resolve_main_slot_from_legacy_context(context or "auto", now_local)

    if not requested_main:
        requested_main = "regular"
    if requested_main not in MAIN_SLOT_MAP:
        raise HTTPException(status_code=422, detail="main must be regular|ramadan")

    if not requested_slot:
        requested_slot = _default_slot_for_main(requested_main)

    if not _is_valid_main_slot(requested_main, requested_slot):
        raise HTTPException(status_code=422, detail="Invalid slot for selected main")

    visibility = _get_ramadan_visibility(now_local)
    if requested_main == "ramadan" and not visibility["visible"]:
        requested_main = "regular"
        requested_slot = _default_slot_for_main("regular")

    next_change_at = _next_change_at_for_menu_slot(requested_main, requested_slot, now_local)
    cache_key = _menu_cache_key_for_slot(requested_main, requested_slot)
    payload = _cache_get_json(cache_key)
    if not isinstance(payload, dict):
        items = _get_slot_items(requested_main, requested_slot)
        generated_at = datetime.now(ZoneInfo(_menu_timezone())).isoformat()
        payload = {
            "main": requested_main,
            "slot": requested_slot,
            "items": items,
            "generated_at": generated_at,
            "next_change_at": next_change_at,
            "ramadan_visible": bool(visibility["visible"]),
        }
        ttl_seconds = _menu_cache_ttl_seconds()
        if next_change_at:
            try:
                next_dt = datetime.fromisoformat(next_change_at)
                seconds_until_change = int((next_dt - now_local).total_seconds())
                if seconds_until_change > 0:
                    ttl_seconds = min(ttl_seconds, seconds_until_change)
            except Exception:
                pass
        _cache_set_json(cache_key, payload, max(ttl_seconds, 1))
    else:
        payload["main"] = requested_main
        payload["slot"] = requested_slot
        payload["next_change_at"] = next_change_at
        payload["ramadan_visible"] = bool(visibility["visible"])
        payload.setdefault("generated_at", datetime.now(ZoneInfo(_menu_timezone())).isoformat())
        payload.setdefault("items", [])

    return payload


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


@app.delete("/api/orders/{order_id}")
def delete_order(
    order_id: str,
    authorization: str | None = Header(default=None),
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
):
    _should_fail()
    if order_id == "me":
        raise HTTPException(status_code=405, detail="Method not allowed")

    auth = _extract_auth(authorization, access_token)
    if not auth:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    student_id = auth["student_id"]
    is_admin = auth.get("role") == "admin"

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT student_id FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found")
            if row[0] != student_id and not is_admin:
                raise HTTPException(status_code=403, detail="Forbidden")
            cur.execute("DELETE FROM orders WHERE id = %s", (order_id,))
            conn.commit()

    return {"ok": True, "order_id": order_id}


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
