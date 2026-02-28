import os
import secrets

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
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


class LoginRequest(BaseModel):
    student_id: str
    password: str


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
    query = """
        SELECT student_id, full_name
        FROM students
        WHERE student_id = %s AND password = %s AND is_active = TRUE
    """

    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (payload.student_id.strip(), payload.password))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=401,
                    detail={"message": "Invalid student ID or password", "error": "Unauthorized"},
                )

            student_id, full_name = row
            token = secrets.token_urlsafe(24)
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
        },
    }
