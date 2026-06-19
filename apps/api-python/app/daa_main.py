import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
import psycopg2
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
JWT_SECRET = os.getenv("JWT_SECRET", "supersecret_supersecret")
JWT_EXPIRES_IN = os.getenv("JWT_EXPIRES_IN", "12h")
DAA_DEMO_TOKEN = os.getenv("DAA_DEMO_TOKEN", "")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")

app = FastAPI(title="DAA External System API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginPayload(BaseModel):
    username: str
    password: str

@dataclass
class CurrentUser:
    user_id: str
    username: str
    role: str
    full_name: str

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def query(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

def query_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None

def _parse_expires_in(raw: str) -> int:
    raw = raw.strip().lower()
    if raw.endswith("h"):
        return int(raw[:-1]) * 3600
    if raw.endswith("m"):
        return int(raw[:-1]) * 60
    return int(raw)

def sign_token(user: dict[str, Any]) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_parse_expires_in(JWT_EXPIRES_IN))
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "full_name": user.get("full_name", user["username"]),
        "exp": expires_at,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def require_auth(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc
    username = payload.get("username")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload"
        )
    current_user = query_one(
        """
        SELECT id::text, username, role, full_name
        FROM users
        WHERE username = %s
        """,
        (username,),
    )
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists"
        )
    return CurrentUser(
        user_id=current_user["id"],
        username=current_user["username"],
        role=current_user["role"],
        full_name=current_user.get("full_name") or current_user["username"],
    )

def require_roles(*roles: str):
    def dependency(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden"
            )
        return user
    return dependency

class GradeUpdatePayload(BaseModel):
    processScore: float | None = None
    midtermScore: float | None = None
    practicalScore: float | None = None
    finalScore: float | None = None

def can_access_offering(user: CurrentUser, offering_id: str) -> bool:
    if user.role == "DEAN_ADMIN":
        return (
            query_one("SELECT 1 AS ok FROM course_offerings WHERE id = %s", (offering_id,))
            is not None
        )
    if user.role == "LECTURER":
        return (
            query_one(
                "SELECT 1 AS ok FROM course_offerings WHERE id = %s AND lecturer_user_id = %s",
                (offering_id, user.user_id),
            )
            is not None
        )
    return False

@app.post("/auth/login")
def login(payload: LoginPayload) -> dict[str, Any]:
    user = query_one("SELECT * FROM users WHERE username = %s", (payload.username,))
    if not user or not bcrypt.checkpw(
        payload.password.encode("utf-8"), user["password_hash"].encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sai tai khoan hoac mat khau",
        )
    token = sign_token(user)
    return {"accessToken": token}

@app.get("/health")
def health():
    return {"status": "ok", "service": "daa-external-api"}

@app.get("/daa-demo/offerings")
def daa_demo_offerings(
    user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER"))
) -> list[dict[str, Any]]:
    if user.role == "DEAN_ADMIN":
        params: tuple[Any, ...] = ()
        lecturer_filter = "WHERE co.lecturer_user_id IS NOT NULL"
    else:
        params = (user.user_id,)
        lecturer_filter = "WHERE co.lecturer_user_id = %s"

    return query(
        f"""
        SELECT
          co.id AS "offeringId",
          cl.class_code AS "classCode",
          cl.class_name AS "className",
          t.term_code AS "termCode",
          t.term_name AS "termName",
          c.course_code AS "courseCode",
          c.course_name AS "courseName",
          c.credits::int AS credits,
          COALESCE(co.lecturer_name, u.full_name, 'Giảng viên') AS "lecturerName",
          COUNT(e.id)::int AS "studentCount"
        FROM course_offerings co
        JOIN classes cl ON cl.id = co.class_id
        JOIN courses c ON c.id = co.course_id
        JOIN terms t ON t.id = co.term_id
        LEFT JOIN users u ON u.id = co.lecturer_user_id
        LEFT JOIN enrollments e ON e.course_offering_id = co.id
        {lecturer_filter}
        GROUP BY co.id, cl.class_code, cl.class_name, t.term_code, t.term_name,
                 c.course_code, c.course_name, c.credits, co.lecturer_name, u.full_name, t.start_date
        HAVING COUNT(e.id) > 0
        ORDER BY t.start_date DESC, cl.class_code, c.course_code
        LIMIT 80
        """,
        params,
    )

@app.get("/daa-demo/offerings/{offering_id}/students")
def daa_demo_offering_students(
    offering_id: str, user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER"))
) -> list[dict[str, Any]]:
    if not can_access_offering(user, offering_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden offering scope"
        )
    return query(
        """
        SELECT
          s.mssv,
          s.full_name AS "fullName",
          e.process_score::float AS "processScore",
          e.midterm_score::float AS "midtermScore",
          e.practical_score::float AS "practicalScore",
          e.final_score::float AS "finalScore",
          COALESCE(e.overall_score, e.final_score)::float AS "overallScore",
          e.letter_grade AS "letterGrade",
          e.passed,
          e.synced_at::text AS "syncedAt",
          e.source_system AS "sourceSystem"
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        WHERE e.course_offering_id = %s
        ORDER BY s.full_name, s.mssv
        """,
        (offering_id,),
    )

@app.get("/daa-demo/offerings/{offering_id}/students/{mssv}/grades")
def daa_demo_student_grade(
    offering_id: str,
    mssv: str,
    user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER")),
) -> dict[str, Any]:
    if not can_access_offering(user, offering_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden offering scope"
        )
    row = query_one(
        """
        SELECT
          s.mssv,
          s.full_name AS "fullName",
          cl.class_code AS "classCode",
          t.term_code AS "termCode",
          c.course_code AS "courseCode",
          c.course_name AS "courseName",
          c.credits::int AS credits,
          e.attempt_no::int AS "attemptNo",
          e.process_score::float AS "processScore",
          e.midterm_score::float AS "midtermScore",
          e.practical_score::float AS "practicalScore",
          e.final_score::float AS "finalScore",
          COALESCE(e.overall_score, e.final_score)::float AS "overallScore",
          e.letter_grade AS "letterGrade",
          e.passed,
          e.synced_at::text AS "syncedAt",
          e.source_system AS "sourceSystem"
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN classes cl ON cl.id = co.class_id
        JOIN courses c ON c.id = co.course_id
        JOIN terms t ON t.id = co.term_id
        WHERE e.course_offering_id = %s AND s.mssv = %s
        """,
        (offering_id, mssv),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grade not found")
    return row

@app.post("/daa-demo/offerings/{offering_id}/students/{mssv}/grades")
def daa_demo_update_grade(
    offering_id: str,
    mssv: str,
    payload: GradeUpdatePayload,
    user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER")),
) -> dict[str, Any]:
    if not can_access_offering(user, offering_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden offering scope"
        )
    
    student = query_one("SELECT id FROM students WHERE mssv = %s", (mssv,))
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            # First, update the specific enrollment and calculate overall_score
            cur.execute(
                """
                UPDATE enrollments
                SET process_score = COALESCE(%s, process_score),
                    midterm_score = COALESCE(%s, midterm_score),
                    practical_score = COALESCE(%s, practical_score),
                    final_score = COALESCE(%s, final_score),
                    synced_at = NULL
                WHERE course_offering_id = %s AND student_id = %s
                """,
                (payload.processScore, payload.midtermScore, payload.practicalScore, payload.finalScore, offering_id, student["id"])
            )
            
            # Recalculate overall_score for this enrollment
            # Formula: process*0.1 + midterm*0.2 + practical*0.2 + final*0.5
            # We use COALESCE to fallback to final_score for any missing component to keep it simple for the demo
            cur.execute(
                """
                UPDATE enrollments
                SET overall_score = ROUND((
                    COALESCE(process_score, final_score) * 0.1 +
                    COALESCE(midterm_score, final_score) * 0.2 +
                    COALESCE(practical_score, final_score) * 0.2 +
                    COALESCE(final_score, 0) * 0.5
                )::numeric, 1)
                WHERE course_offering_id = %s AND student_id = %s
                """,
                (offering_id, student["id"])
            )

            # Recalculate and update the student's current_gpa
            cur.execute(
                """
                UPDATE students s
                SET current_gpa = stats.avg_score
                FROM (
                    SELECT student_id, ROUND(AVG(overall_score)::numeric, 2) AS avg_score
                    FROM enrollments
                    WHERE student_id = %s
                    GROUP BY student_id
                ) AS stats
                WHERE s.id = stats.student_id
                """,
                (student["id"],)
            )
            conn.commit()
    
    return {"status": "success"}

@app.get("/daa-demo/api/snapshot")
def daa_demo_snapshot(
    x_daa_token: str | None = Header(default=None, alias="X-DAA-Token"),
    cookie: str | None = Header(default=None)
) -> dict[str, Any]:
    # Allow if valid token OR if any cookie is provided (simulating session auth)
    if not cookie:
        if DAA_DEMO_TOKEN and x_daa_token != DAA_DEMO_TOKEN:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid DAA token")

    rows = query(
        """
        SELECT
          s.mssv,
          s.full_name AS "fullName",
          cl.class_code AS "classCode",
          cl.class_name AS "className",
          t.term_code AS "termCode",
          t.term_name AS "termName",
          t.start_date::text AS "termStartDate",
          t.end_date::text AS "termEndDate",
          c.course_code AS "courseCode",
          c.course_name AS "courseName",
          c.credits::int AS credits,
          COALESCE(e.attempt_no, 1)::int AS "attemptNo",
          COALESCE(e.is_retake, FALSE) AS "isRetake",
          COALESCE(e.process_score, e.final_score)::float AS "processScore",
          COALESCE(e.midterm_score, e.final_score)::float AS "midtermScore",
          COALESCE(e.practical_score, e.final_score)::float AS "practicalScore",
          e.final_score::float AS "finalScore",
          COALESCE(e.overall_score, e.final_score)::float AS "overallScore",
          e.letter_grade AS "letterGrade",
          e.passed,
          COALESCE(e.source_system, 'daa_demo') AS "sourceSystem",
          COALESCE(co.lecturer_name, u.full_name, 'Giảng viên') AS "lecturerName"
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN classes cl ON cl.id = co.class_id
        JOIN courses c ON c.id = co.course_id
        JOIN terms t ON t.id = co.term_id
        LEFT JOIN users u ON u.id = co.lecturer_user_id
        WHERE co.lecturer_user_id IS NOT NULL
        ORDER BY t.start_date DESC, cl.class_code, c.course_code, s.mssv
        LIMIT 500
        """
    )
    return {
        "sourceName": "daa_demo",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "results": rows,
    }
