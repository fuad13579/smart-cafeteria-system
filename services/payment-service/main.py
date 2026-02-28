import os
import time
import uuid

import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

chaos_state = {"enabled": False, "mode": "error"}

metrics: dict[str, float] = {
    "payments_total": 0,
    "payments_failed_total": 0,
    "latency_total_ms": 0,
    "latency_count": 0,
}


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


class ChargeRequest(BaseModel):
    order_id: str
    student_id: str
    amount: float


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


@app.get("/health")
def health():
    if chaos_state["enabled"]:
        raise HTTPException(status_code=503, detail="chaos mode enabled")

    try:
        _redis_client().ping()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"redis unavailable: {exc}")

    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    avg_latency = metrics["latency_total_ms"] / metrics["latency_count"] if metrics["latency_count"] else 0
    return {
        "payments_total": metrics["payments_total"],
        "payments_failed_total": metrics["payments_failed_total"],
        "avg_response_latency_ms": round(avg_latency, 2),
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.post("/payments/charge")
def charge_payment(payload: ChargeRequest):
    start = time.perf_counter()
    _should_fail()

    if payload.amount <= 0:
        metrics["payments_failed_total"] += 1
        raise HTTPException(status_code=422, detail="amount must be positive")

    rc = _redis_client()
    key = f"payment:{payload.order_id}"
    existing = rc.get(key)
    if existing:
        metrics["payments_total"] += 1
        elapsed_ms = (time.perf_counter() - start) * 1000
        metrics["latency_total_ms"] += elapsed_ms
        metrics["latency_count"] += 1
        return {"charged": True, "already_charged": True, "order_id": payload.order_id, "transaction_id": existing}

    # Simulate external payment gateway latency.
    time.sleep(0.25)

    txn_id = f"txn-{uuid.uuid4()}"
    rc.setex(key, 86400, txn_id)

    metrics["payments_total"] += 1
    elapsed_ms = (time.perf_counter() - start) * 1000
    metrics["latency_total_ms"] += elapsed_ms
    metrics["latency_count"] += 1

    return {"charged": True, "already_charged": False, "order_id": payload.order_id, "transaction_id": txn_id}


@app.get("/payments/{order_id}")
def get_payment(order_id: str):
    _should_fail()
    txn_id = _redis_client().get(f"payment:{order_id}")
    if not txn_id:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"order_id": order_id, "paid": True, "transaction_id": txn_id}
