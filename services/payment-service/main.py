import json
import os
import time
import uuid
from datetime import datetime, timezone

import pika
import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()

chaos_state = {"enabled": False, "mode": "error"}

metrics: dict[str, float] = {
    "payments_total": 0,
    "payments_failed_total": 0,
    "health_checks_total": 0,
    "queue_publish_failed_total": 0,
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _should_fail() -> None:
    if not chaos_state["enabled"]:
        return
    if chaos_state["mode"] == "timeout":
        time.sleep(2)
    raise HTTPException(status_code=503, detail="Service in chaos mode")


def _ensure_schema() -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payments (
                    payment_id TEXT PRIMARY KEY,
                    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
                    student_id TEXT NOT NULL REFERENCES students(student_id),
                    amount INTEGER NOT NULL CHECK (amount >= 0),
                    currency TEXT NOT NULL DEFAULT 'BDT',
                    method TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'COMPLETED',
                    transaction_ref TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
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
            conn.commit()


def _publish_payment_completed(payment: dict) -> None:
    event = {
        "event": "payment.completed",
        "event_id": f"evt-{uuid.uuid4()}",
        "occurred_at": _now_iso(),
        "payment": payment,
    }

    try:
        connection = pika.BlockingConnection(_rabbit_params())
        channel = connection.channel()
        channel.queue_declare(queue="payment.completed", durable=True)
        channel.basic_publish(
            exchange="",
            routing_key="payment.completed",
            body=json.dumps(event),
            properties=pika.BasicProperties(delivery_mode=2),
        )
        connection.close()
    except Exception as exc:
        metrics["queue_publish_failed_total"] += 1
        raise HTTPException(status_code=503, detail=f"Queue unavailable: {exc}") from exc


class ProcessPaymentRequest(BaseModel):
    order_id: str
    student_id: str
    amount: int = Field(ge=0)
    currency: str = "BDT"
    method: str
    transaction_ref: str | None = None


class ChaosRequest(BaseModel):
    enabled: bool
    mode: str = "error"


@app.on_event("startup")
def on_startup():
    _ensure_schema()


@app.get("/health")
def health():
    metrics["health_checks_total"] += 1
    if chaos_state["enabled"]:
        raise HTTPException(status_code=503, detail="chaos mode enabled")

    try:
        with _db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database unavailable: {exc}") from exc

    try:
        connection = pika.BlockingConnection(_rabbit_params())
        connection.close()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"rabbitmq unavailable: {exc}") from exc

    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    return {
        "payments_total": metrics["payments_total"],
        "payments_failed_total": metrics["payments_failed_total"],
        "health_checks_total": metrics["health_checks_total"],
        "queue_publish_failed_total": metrics["queue_publish_failed_total"],
    }


@app.post("/chaos/fail")
def chaos_fail(payload: ChaosRequest):
    chaos_state["enabled"] = payload.enabled
    chaos_state["mode"] = payload.mode if payload.mode in {"error", "timeout"} else "error"
    return {"status": "ok", "chaos": chaos_state}


@app.post("/payments/process")
def process_payment(payload: ProcessPaymentRequest):
    _should_fail()
    metrics["payments_total"] += 1

    method = payload.method.strip().upper()
    if method not in {"CARD", "CASH", "MFS"}:
        metrics["payments_failed_total"] += 1
        raise HTTPException(status_code=422, detail="method must be CARD, CASH, or MFS")

    payment: dict | None = None
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT payment_id, order_id, student_id, amount, currency, method, status, transaction_ref, created_at
                FROM payments
                WHERE order_id = %s
                """,
                (payload.order_id,),
            )
            existing = cur.fetchone()
            if existing:
                return {
                    "ok": True,
                    "already_processed": True,
                    "payment": {
                        "payment_id": existing[0],
                        "order_id": existing[1],
                        "student_id": existing[2],
                        "amount": int(existing[3]),
                        "currency": existing[4],
                        "method": existing[5],
                        "status": existing[6],
                        "transaction_ref": existing[7],
                        "created_at": existing[8].isoformat(),
                    },
                }

            cur.execute(
                """
                SELECT student_id, total_amount, status
                FROM orders
                WHERE id = %s
                FOR UPDATE
                """,
                (payload.order_id,),
            )
            order_row = cur.fetchone()
            if not order_row:
                metrics["payments_failed_total"] += 1
                raise HTTPException(status_code=404, detail="Order not found")

            order_student_id, total_amount, order_status = order_row
            if order_student_id != payload.student_id:
                metrics["payments_failed_total"] += 1
                raise HTTPException(status_code=409, detail="Student mismatch for order")
            if order_status == "CANCELLED":
                metrics["payments_failed_total"] += 1
                raise HTTPException(status_code=409, detail="Cannot pay for cancelled order")
            if int(total_amount) != int(payload.amount):
                metrics["payments_failed_total"] += 1
                raise HTTPException(status_code=409, detail="Payment amount must match order total")

            cur.execute(
                """
                SELECT account_balance
                FROM students
                WHERE student_id = %s AND is_active = TRUE
                FOR UPDATE
                """,
                (payload.student_id,),
            )
            student_row = cur.fetchone()
            if not student_row:
                metrics["payments_failed_total"] += 1
                raise HTTPException(status_code=404, detail="Student not found")

            balance = int(student_row[0])
            if balance < payload.amount:
                metrics["payments_failed_total"] += 1
                raise HTTPException(status_code=409, detail="Insufficient account balance")
            balance_after = balance - payload.amount

            payment_id = f"pay-{uuid.uuid4()}"
            tx_ref = (payload.transaction_ref or f"txn-{uuid.uuid4().hex[:10]}").strip()

            cur.execute(
                """
                UPDATE students
                SET account_balance = account_balance - %s
                WHERE student_id = %s
                """,
                (payload.amount, payload.student_id),
            )
            cur.execute(
                """
                INSERT INTO wallet_transactions (
                    student_id, txn_type, direction, amount, balance_before, balance_after, reference_type, reference_id, metadata
                )
                VALUES (%s, 'ORDER_PAYMENT', 'DEBIT', %s, %s, %s, 'order', %s, %s::jsonb)
                """,
                (
                    payload.student_id,
                    payload.amount,
                    balance,
                    balance_after,
                    payload.order_id,
                    json.dumps({"payment_method": method}),
                ),
            )
            cur.execute(
                """
                INSERT INTO payments (
                    payment_id, order_id, student_id, amount, currency, method, status, transaction_ref
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'COMPLETED', %s)
                RETURNING payment_id, order_id, student_id, amount, currency, method, status, transaction_ref, created_at
                """,
                (
                    payment_id,
                    payload.order_id,
                    payload.student_id,
                    payload.amount,
                    payload.currency.upper().strip() or "BDT",
                    method,
                    tx_ref,
                ),
            )
            row = cur.fetchone()
            conn.commit()

            payment = {
                "payment_id": row[0],
                "order_id": row[1],
                "student_id": row[2],
                "amount": int(row[3]),
                "currency": row[4],
                "method": row[5],
                "status": row[6],
                "transaction_ref": row[7],
                "created_at": row[8].isoformat(),
            }

    if payment is None:
        metrics["payments_failed_total"] += 1
        raise HTTPException(status_code=500, detail="Payment processing failed")

    _publish_payment_completed(payment)
    return {"ok": True, "already_processed": False, "payment": payment}


@app.get("/payments/{payment_id}")
def get_payment(payment_id: str):
    _should_fail()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT payment_id, order_id, student_id, amount, currency, method, status, transaction_ref, created_at
                FROM payments
                WHERE payment_id = %s
                """,
                (payment_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Payment not found")
            return {
                "payment_id": row[0],
                "order_id": row[1],
                "student_id": row[2],
                "amount": int(row[3]),
                "currency": row[4],
                "method": row[5],
                "status": row[6],
                "transaction_ref": row[7],
                "created_at": row[8].isoformat(),
            }


@app.get("/payments/by-order/{order_id}")
def get_payment_by_order(order_id: str):
    _should_fail()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT payment_id, order_id, student_id, amount, currency, method, status, transaction_ref, created_at
                FROM payments
                WHERE order_id = %s
                """,
                (order_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Payment not found")
            return {
                "payment_id": row[0],
                "order_id": row[1],
                "student_id": row[2],
                "amount": int(row[3]),
                "currency": row[4],
                "method": row[5],
                "status": row[6],
                "transaction_ref": row[7],
                "created_at": row[8].isoformat(),
            }
