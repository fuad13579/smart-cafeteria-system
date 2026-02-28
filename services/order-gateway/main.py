import json
import os
from typing import Any
import urllib.error
import urllib.request
import uuid

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import psycopg

app = FastAPI()


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


class LoginRequest(BaseModel):
    student_id: str
    password: str


class OrderLine(BaseModel):
    id: str
    qty: int = Field(gt=0)


class CreateOrderRequest(BaseModel):
    items: list[OrderLine]


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


@app.get("/health")
def health():
    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database unavailable: {exc}")


@app.post("/api/login")
def login(payload: LoginRequest):
    url = f"{_identity_url()}/login"
    data = json.dumps(payload.model_dump()).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        message = "Login failed"
        try:
            parsed = json.loads(exc.read().decode("utf-8"))
            detail = parsed.get("detail")
            if isinstance(detail, dict):
                message = detail.get("message", message)
        except Exception:
            pass
        return JSONResponse(
            status_code=exc.code,
            content={"message": message, "error": "Unauthorized"},
        )
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"message": f"Identity service unavailable: {exc}", "error": "Service Unavailable"},
        )


@app.get("/api/menu")
def get_menu():
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
    if not payload.items:
        return JSONResponse(
            status_code=400,
            content={"message": "Order items are required", "error": "Bad Request"},
        )

    student_id = _extract_student_id(authorization)
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
                    return JSONResponse(
                        status_code=400,
                        content={"message": f"Item {line.id} not found", "error": "Bad Request"},
                    )
                if not item["available"]:
                    return JSONResponse(
                        status_code=400,
                        content={"message": f"Item {item['name']} is unavailable", "error": "Bad Request"},
                    )

            order_id = str(uuid.uuid4())
            total = sum(menu_map[line.id]["price"] * line.qty for line in payload.items)
            status = "QUEUED"
            eta_minutes = 12

            cur.execute(
                """
                INSERT INTO orders(id, student_id, status, eta_minutes, total_amount)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (order_id, student_id, status, eta_minutes, total),
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

    return {"order_id": order_id, "status": status, "eta_minutes": eta_minutes}
