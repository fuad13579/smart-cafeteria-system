import os
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from fastapi import Header
from pydantic import BaseModel
import psycopg
import jwt

app = FastAPI()
metrics: dict[str, float] = {
    "login_total": 0,
    "login_failed_total": 0,
    "verify_total": 0,
    "verify_failed_total": 0,
}


def _db_conn():
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "cafeteria"),
        user=os.getenv("POSTGRES_USER", "cafeteria"),
        password=os.getenv("POSTGRES_PASSWORD", "cafeteria"),
    )


class LoginRequest(BaseModel):
    student_id: str
    password: str


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "dev-only-change-me")


def _jwt_algorithm() -> str:
    return os.getenv("JWT_ALGORITHM", "HS256")


def _jwt_exp_minutes() -> int:
    raw = os.getenv("JWT_EXPIRES_MINUTES", "60")
    try:
        value = int(raw)
        return value if value > 0 else 60
    except ValueError:
        return 60


def _create_access_token(student_id: str) -> str:
    role = _resolve_role(student_id)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": student_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_jwt_exp_minutes())).timestamp()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_jwt_algorithm())


def _decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[_jwt_algorithm()])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def _resolve_role(student_id: str) -> str:
    admins = {x.strip() for x in os.getenv("ADMIN_STUDENT_IDS", "admin-demo").split(",") if x.strip()}
    return "admin" if student_id in admins else "student"


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


@app.post("/login")
def login(payload: LoginRequest):
    metrics["login_total"] += 1
    query = """
        SELECT student_id, full_name, account_balance
        FROM students
        WHERE student_id = %s AND password = %s AND is_active = TRUE
    """

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (payload.student_id.strip(), payload.password))
            row = cur.fetchone()
            if not row:
                metrics["login_failed_total"] += 1
                raise HTTPException(
                    status_code=401,
                    detail={"message": "Invalid student ID or password", "error": "Unauthorized"},
                )

            student_id, full_name, account_balance = row
            token = _create_access_token(student_id)
            cur.execute(
                "INSERT INTO auth_tokens(token, student_id) VALUES (%s, %s)",
                (token, student_id),
            )
            conn.commit()

    return {
        "access_token": token,
        "user": {
            "id": student_id,
            "student_id": student_id,
            "name": full_name,
            "account_balance": account_balance,
            "role": _resolve_role(student_id),
        },
    }


@app.get("/metrics")
def get_metrics():
    return {
        "login_total": metrics["login_total"],
        "login_failed_total": metrics["login_failed_total"],
        "verify_total": metrics["verify_total"],
        "verify_failed_total": metrics["verify_failed_total"],
    }


@app.get("/verify")
def verify_token(authorization: str | None = Header(default=None)):
    metrics["verify_total"] += 1
    if not authorization or not authorization.startswith("Bearer "):
        metrics["verify_failed_total"] += 1
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        metrics["verify_failed_total"] += 1
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        claims = _decode_access_token(token)
    except HTTPException:
        metrics["verify_failed_total"] += 1
        raise
    student_id = claims.get("sub")
    role = claims.get("role", "student")
    if not student_id:
        metrics["verify_failed_total"] += 1
        raise HTTPException(status_code=401, detail="Invalid token payload")

    return {"valid": True, "student_id": student_id, "role": role}


@app.post("/refresh")
def refresh_token(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    claims = _decode_access_token(token)
    student_id = claims.get("sub")
    if not student_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    new_token = _create_access_token(student_id)
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO auth_tokens(token, student_id) VALUES (%s, %s)",
                (new_token, student_id),
            )
            conn.commit()

    return {"access_token": new_token}
