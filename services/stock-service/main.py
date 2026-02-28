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
            cur.execute("SELECT id, name, available FROM menu_items WHERE id = %s", (item_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            return {"id": row[0], "name": row[1], "available": bool(row[2])}


@app.post("/stock/reserve")
def reserve_stock(payload: ReserveRequest):
    _should_fail()
    metrics["reserve_total"] += 1

    if payload.qty <= 0:
        metrics["reserve_failed_total"] += 1
        raise HTTPException(status_code=422, detail="qty must be positive")

    rc = _redis_client()
    existing_item = rc.get(f"reserve:{payload.order_id}")
    if existing_item:
        if existing_item == payload.item_id:
            return {"reserved": True, "already_reserved": True, "order_id": payload.order_id, "item_id": payload.item_id}
        metrics["reserve_failed_total"] += 1
        raise HTTPException(status_code=409, detail="Order already reserved for another item")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT available FROM menu_items WHERE id = %s", (payload.item_id,))
            row = cur.fetchone()
            if not row:
                metrics["reserve_failed_total"] += 1
                raise HTTPException(status_code=404, detail="Item not found")
            if not bool(row[0]):
                metrics["reserve_failed_total"] += 1
                raise HTTPException(status_code=409, detail="Item unavailable")

            cur.execute(
                "UPDATE menu_items SET available = FALSE WHERE id = %s AND available = TRUE",
                (payload.item_id,),
            )
            if cur.rowcount != 1:
                metrics["reserve_failed_total"] += 1
                raise HTTPException(status_code=409, detail="Item unavailable")
            conn.commit()

    rc.setex(f"reserve:{payload.order_id}", 3600, payload.item_id)
    return {"reserved": True, "already_reserved": False, "order_id": payload.order_id, "item_id": payload.item_id}


@app.post("/stock/release")
def release_stock(payload: ReleaseRequest):
    _should_fail()
    rc = _redis_client()
    item_id = rc.get(f"reserve:{payload.order_id}")
    if not item_id:
        raise HTTPException(status_code=404, detail="Reservation not found")

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE menu_items SET available = TRUE WHERE id = %s", (item_id,))
            conn.commit()

    rc.delete(f"reserve:{payload.order_id}")
    return {"released": True, "order_id": payload.order_id, "item_id": item_id}
