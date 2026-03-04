import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import pika
import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()

chaos_state = {"enabled": False, "mode": "error"}

metrics: dict[str, float] = {
    "payments_total": 0,
    "payments_failed_total": 0,
    "topups_total": 0,
    "topups_failed_total": 0,
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
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS wallet_topups (
                    topup_id TEXT PRIMARY KEY,
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


class MockTopupRequest(BaseModel):
    student_id: str
    amount: int = Field(gt=0)
    method: str
    mode: str = "normal"
    details: dict[str, Any] | None = None
    idempotency_key: str | None = None


class MockWebhookRequest(BaseModel):
    topup_id: str
    status: str
    provider_txn_id: str | None = None


def _normalize_wallet_method(method: str) -> str:
    normalized = method.strip().lower()
    if normalized in {"bank", "bnk"}:
        return "BANK"
    if normalized in {"bkash", "bk"}:
        return "BKASH"
    if normalized in {"nagad", "nag"}:
        return "NAGAD"
    raise HTTPException(status_code=422, detail="method must be BANK, BKASH, or NAGAD")


def _topup_to_response(row: tuple) -> dict[str, Any]:
    return {
        "topup_id": row[0],
        "student_id": row[1],
        "amount": int(row[2]),
        "method": row[3],
        "status": row[4],
        "provider_ref": row[5],
        "idempotency_key": row[6],
        "created_at": row[7].isoformat() if row[7] else None,
        "completed_at": row[8].isoformat() if row[8] else None,
    }


def _complete_topup(cur: psycopg.Cursor[Any], topup_id: str, provider_ref: str | None = None) -> tuple[bool, dict[str, Any]]:
    cur.execute(
        """
        SELECT topup_id, student_id, amount, method, status, provider_ref, idempotency_key, created_at, completed_at
        FROM wallet_topups
        WHERE topup_id = %s
        FOR UPDATE
        """,
        (topup_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Top-up not found")

    topup = _topup_to_response(row)
    if topup["status"] == "COMPLETED":
        cur.execute("SELECT account_balance FROM students WHERE student_id = %s", (topup["student_id"],))
        bal_row = cur.fetchone()
        topup["account_balance"] = int(bal_row[0]) if bal_row else None
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
    student_row = cur.fetchone()
    if not student_row:
        raise HTTPException(status_code=404, detail="Student not found")
    balance_before = int(student_row[0])
    balance_after = balance_before + int(topup["amount"])

    cur.execute(
        "UPDATE students SET account_balance = %s WHERE student_id = %s",
        (balance_after, topup["student_id"]),
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
            balance_before,
            balance_after,
            topup_id,
            json.dumps({"method": topup["method"]}),
        ),
    )
    cur.execute(
        """
        UPDATE wallet_topups
        SET status = 'COMPLETED',
            provider_ref = COALESCE(%s, provider_ref),
            completed_at = NOW()
        WHERE topup_id = %s
        """,
        (provider_ref, topup_id),
    )
    topup["status"] = "COMPLETED"
    topup["provider_ref"] = provider_ref or topup.get("provider_ref")
    topup["completed_at"] = _now_iso()
    topup["account_balance"] = balance_after
    return False, topup


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
        "topups_total": metrics["topups_total"],
        "topups_failed_total": metrics["topups_failed_total"],
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


@app.post("/wallet/topups/mock")
def create_mock_topup(payload: MockTopupRequest):
    _should_fail()
    metrics["topups_total"] += 1

    student_id = payload.student_id.strip()
    if not student_id:
        metrics["topups_failed_total"] += 1
        raise HTTPException(status_code=422, detail="student_id is required")

    method = _normalize_wallet_method(payload.method)
    mode = (payload.mode or "normal").strip().lower()
    if mode not in {"normal", "demo"}:
        metrics["topups_failed_total"] += 1
        raise HTTPException(status_code=422, detail="mode must be normal or demo")

    key = (payload.idempotency_key or "").strip() or None
    topup_id = f"topup-{uuid.uuid4().hex[:12]}"
    details = payload.details or {}
    provided_ref = str(details.get("reference_id") or "").strip()
    reference_id = provided_ref or f"TOPUP-{uuid.uuid4().hex[:6].upper()}"
    redirect_url = f"https://pay.local/{method.lower()}/{topup_id}" if method in {"BKASH", "NAGAD"} else None

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT student_id FROM students WHERE student_id = %s AND is_active = TRUE",
                (student_id,),
            )
            if not cur.fetchone():
                metrics["topups_failed_total"] += 1
                raise HTTPException(status_code=404, detail="Student not found")

            if key:
                cur.execute(
                    """
                    SELECT topup_id, student_id, amount, method, status, provider_ref, idempotency_key, created_at, completed_at
                    FROM wallet_topups
                    WHERE student_id = %s AND idempotency_key = %s
                    """,
                    (student_id, key),
                )
                replay = cur.fetchone()
                if replay:
                    topup = _topup_to_response(replay)
                    replay_redirect_url = (
                        None
                        if topup["status"] == "COMPLETED" or topup["method"] not in {"BKASH", "NAGAD"}
                        else f"https://pay.local/{str(topup['method']).lower()}/{topup['topup_id']}"
                    )
                    return {
                        "ok": True,
                        "replayed": True,
                        "topup": {
                            "topup_id": topup["topup_id"],
                            "amount": topup["amount"],
                            "method": topup["method"],
                            "status": topup["status"],
                            "reference_id": topup["provider_ref"] or reference_id,
                            "redirect_url": replay_redirect_url,
                        },
                    }

            cur.execute(
                """
                INSERT INTO wallet_topups (
                    topup_id, student_id, amount, method, status, provider_ref, idempotency_key
                )
                VALUES (%s, %s, %s, %s, 'PENDING', %s, %s)
                """,
                (topup_id, student_id, payload.amount, method, reference_id, key),
            )

            if mode == "demo" and method in {"BKASH", "NAGAD"}:
                replayed, topup = _complete_topup(cur, topup_id, provider_ref=reference_id)
                conn.commit()
                return {
                    "ok": True,
                    "replayed": replayed,
                    "message": "Demo top-up successful",
                    "topup": {
                        "topup_id": topup_id,
                        "amount": payload.amount,
                        "method": method,
                        "status": "COMPLETED",
                        "reference_id": reference_id,
                        "redirect_url": None,
                    },
                    "account_balance": topup.get("account_balance"),
                }

            conn.commit()

    return {
        "ok": True,
        "replayed": False,
        "message": "Top-up created",
        "topup": {
            "topup_id": topup_id,
            "amount": payload.amount,
            "method": method,
            "status": "PENDING",
            "reference_id": reference_id,
            "redirect_url": redirect_url,
        },
    }


@app.post("/wallet/webhook/{provider}")
def process_wallet_webhook(provider: str, payload: MockWebhookRequest):
    _should_fail()
    provider_name = provider.strip().lower()
    if provider_name not in {"bkash", "nagad", "bank"}:
        metrics["topups_failed_total"] += 1
        raise HTTPException(status_code=422, detail="provider must be bkash|nagad|bank")

    incoming_status = payload.status.strip().upper()
    if incoming_status not in {"SUCCESS", "FAILED"}:
        metrics["topups_failed_total"] += 1
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
                metrics["topups_failed_total"] += 1
                raise HTTPException(status_code=404, detail="Top-up not found")

            if str(row[1]).strip().lower() != provider_name:
                metrics["topups_failed_total"] += 1
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
                    SET status = 'FAILED',
                        provider_ref = COALESCE(%s, provider_ref),
                        completed_at = NOW()
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


@app.get("/wallet/topups/mock/{topup_id}")
def get_mock_topup(topup_id: str):
    _should_fail()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT topup_id, student_id, amount, method, status, provider_ref, idempotency_key, created_at, completed_at
                FROM wallet_topups
                WHERE topup_id = %s
                """,
                (topup_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Top-up not found")
            return {"topup": _topup_to_response(row)}
