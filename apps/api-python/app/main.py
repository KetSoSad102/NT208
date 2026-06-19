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

try:
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_openai import ChatOpenAI

    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
JWT_SECRET = os.getenv("JWT_SECRET", "supersecret_supersecret")
JWT_EXPIRES_IN = os.getenv("JWT_EXPIRES_IN", "12h")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai").lower()
if LLM_PROVIDER == "google":
    LLM_PROVIDER = "gemini"
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-5.4")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "")
DAA_DEMO_TOKEN = os.getenv("DAA_DEMO_TOKEN", "")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")


app = FastAPI(title="CVHT AI API", version="2.0.0")
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


class NotePayload(BaseModel):
    note: str


class ChatPayload(BaseModel):
    message: str
    mode: str | None = None


class ImportPayload(BaseModel):
    sourceName: str = "manual-trigger"
    daaCookie: str = ""


class GradeUpdatePayload(BaseModel):
    processScore: float | None = None
    midtermScore: float | None = None
    practicalScore: float | None = None
    finalScore: float | None = None


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


def execute(sql: str, params: tuple[Any, ...] = ()) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)


def parse_expires_in_to_seconds(value: str) -> int:
    text = (value or "12h").strip().lower()
    match = re.fullmatch(r"(\d+)([smhd])", text)
    if not match:
        return 12 * 60 * 60
    amount = int(match.group(1))
    unit = match.group(2)
    multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    return amount * multipliers[unit]


def sign_token(user: dict[str, Any]) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=parse_expires_in_to_seconds(JWT_EXPIRES_IN)
    )
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
        "exp": expires_at,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def write_audit_log(
    user: CurrentUser | None,
    action: str,
    resource_type: str,
    resource_id: str | None,
    metadata: dict[str, Any] | None = None,
) -> None:
    execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        """,
        (
            user.user_id if user else None,
            action,
            resource_type,
            resource_id,
            json.dumps(metadata or {}),
        ),
    )


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


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    text = value.lower().strip()
    replacements = {
        "ă": "a",
        "â": "a",
        "đ": "d",
        "ê": "e",
        "ô": "o",
        "ơ": "o",
        "ư": "u",
        "á": "a",
        "à": "a",
        "ả": "a",
        "ã": "a",
        "ạ": "a",
        "ấ": "a",
        "ầ": "a",
        "ẩ": "a",
        "ẫ": "a",
        "ậ": "a",
        "ắ": "a",
        "ằ": "a",
        "ẳ": "a",
        "ẵ": "a",
        "ặ": "a",
        "é": "e",
        "è": "e",
        "ẻ": "e",
        "ẽ": "e",
        "ẹ": "e",
        "ế": "e",
        "ề": "e",
        "ể": "e",
        "ễ": "e",
        "ệ": "e",
        "í": "i",
        "ì": "i",
        "ỉ": "i",
        "ĩ": "i",
        "ị": "i",
        "ó": "o",
        "ò": "o",
        "ỏ": "o",
        "õ": "o",
        "ọ": "o",
        "ố": "o",
        "ồ": "o",
        "ổ": "o",
        "ỗ": "o",
        "ộ": "o",
        "ớ": "o",
        "ờ": "o",
        "ở": "o",
        "ỡ": "o",
        "ợ": "o",
        "ú": "u",
        "ù": "u",
        "ủ": "u",
        "ũ": "u",
        "ụ": "u",
        "ứ": "u",
        "ừ": "u",
        "ử": "u",
        "ữ": "u",
        "ự": "u",
        "ý": "y",
        "ỳ": "y",
        "ỷ": "y",
        "ỹ": "y",
        "ỵ": "y",
    }
    for src, dest in replacements.items():
        text = text.replace(src, dest)
    return re.sub(r"\s+", " ", text)


def get_accessible_classes(user: CurrentUser) -> list[dict[str, Any]]:
    if user.role == "DEAN_ADMIN":
        return query(
            "SELECT id, class_code, class_name, required_credits FROM classes ORDER BY class_code"
        )
    if user.role == "LECTURER":
        return query(
            """
            SELECT DISTINCT c.id, c.class_code, c.class_name, c.required_credits
            FROM classes c
            JOIN course_offerings co ON co.class_id = c.id
            WHERE co.lecturer_user_id = %s
            ORDER BY c.class_code
            """,
            (user.user_id,),
        )
    return query(
        """
        SELECT id, class_code, class_name, required_credits
        FROM classes
        WHERE advisor_user_id = %s
        ORDER BY class_code
        """,
        (user.user_id,),
    )


def can_access_class(user: CurrentUser, class_id: str) -> bool:
    if user.role == "DEAN_ADMIN":
        return (
            query_one("SELECT 1 AS ok FROM classes WHERE id = %s", (class_id,))
            is not None
        )
    if user.role == "LECTURER":
        return (
            query_one(
                """
                SELECT 1 AS ok
                FROM course_offerings
                WHERE class_id = %s AND lecturer_user_id = %s
                LIMIT 1
                """,
                (class_id, user.user_id),
            )
            is not None
        )
    return (
        query_one(
            "SELECT 1 AS ok FROM classes WHERE id = %s AND advisor_user_id = %s",
            (class_id, user.user_id),
        )
        is not None
    )


def can_access_student(user: CurrentUser, mssv: str) -> bool:
    if user.role == "DEAN_ADMIN":
        return (
            query_one("SELECT 1 AS ok FROM students WHERE mssv = %s", (mssv,))
            is not None
        )
    if user.role == "LECTURER":
        return (
            query_one(
                """
                SELECT 1 AS ok
                FROM students s
                JOIN enrollments e ON e.student_id = s.id
                JOIN course_offerings co ON co.id = e.course_offering_id
                WHERE s.mssv = %s AND co.lecturer_user_id = %s
                LIMIT 1
                """,
                (mssv, user.user_id),
            )
            is not None
        )
    return (
        query_one(
            """
            SELECT 1 AS ok
            FROM students s
            JOIN classes c ON c.id = s.class_id
            WHERE s.mssv = %s AND c.advisor_user_id = %s
            """,
            (mssv, user.user_id),
        )
        is not None
    )


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
    return (
        query_one(
            """
            SELECT 1 AS ok
            FROM course_offerings co
            JOIN classes c ON c.id = co.class_id
            WHERE co.id = %s AND c.advisor_user_id = %s
            """,
            (offering_id, user.user_id),
        )
        is not None
    )


MIN_MAIN_TERM_CREDITS = 14
MAX_MAIN_TERM_CREDITS = 30
GRADUATION_WORK_CODES = {"GRD401"}

COURSE_TERM_BY_CODE: dict[str, int] = {
    "ENG01": 1,
    "IT001": 1,
    "MA003": 1,
    "MA006": 1,
    "PH002": 1,
    "SS004": 1,
    "NT015": 1,
    "NT016": 1,
    "IT003": 2,
    "IT005": 2,
    "IT006": 2,
    "MA004": 2,
    "MA005": 2,
    "SS003": 2,
    "SS006": 2,
    "SS008": 2,
    "IT002": 3,
    "IT004": 3,
    "IT007": 3,
    "SS007": 3,
    "SS009": 3,
    "SS010": 3,
    "NT209": 3,
    "NT219": 3,
    "MMT201": 3,
    "MMT202": 3,
    "ENG02": 4,
    "ENG03": 4,
    "NT101": 4,
    "NT102": 4,
    "NT103": 4,
    "MMT203": 4,
    "MMT204": 4,
    "MMT205": 4,
    "NT104": 5,
    "NT105": 5,
    "NT106": 5,
    "NT201": 5,
    "NT202": 5,
    "NT203": 5,
    "MMT301": 5,
    "MMT302": 5,
    "MMT303": 5,
    "MMT304": 5,
    "MMT305": 5,
    "NT204": 6,
    "NT205": 6,
    "NT206": 6,
    "NT207": 6,
    "NT208": 6,
    "MMT306": 6,
    "MMT307": 6,
    "MMT308": 6,
    "MMT309": 6,
    "NT210": 7,
    "NT211": 7,
    "NT212": 7,
    "NT213": 7,
    "NT214": 7,
    "MMT310": 7,
    "MMT311": 7,
    "MMT312": 7,
    "MMT313": 7,
    "ELE001": 5,
    "ELE002": 6,
    "PRJ401": 7,
    "INT401": 7,
    "GRD401": 8,
}

COMMON_COURSES = {
    "ENG01",
    "ENG02",
    "ENG03",
    "IT001",
    "IT002",
    "IT003",
    "IT004",
    "IT005",
    "IT006",
    "IT007",
    "MA003",
    "MA004",
    "MA005",
    "MA006",
    "PH002",
    "SS003",
    "SS004",
    "SS006",
    "SS007",
    "SS008",
    "SS009",
    "SS010",
    "NT102",
    "ELE001",
    "ELE002",
    "PRJ401",
    "INT401",
    "GRD401",
}
ATTT_ONLY_COURSES = {
    "NT015",
    "NT101",
    "NT103",
    "NT104",
    "NT105",
    "NT106",
    "NT201",
    "NT202",
    "NT203",
    "NT204",
    "NT205",
    "NT206",
    "NT207",
    "NT208",
    "NT209",
    "NT210",
    "NT211",
    "NT212",
    "NT213",
    "NT214",
    "NT219",
}
MMT_ONLY_COURSES = {
    "NT016",
    "MMT201",
    "MMT202",
    "MMT203",
    "MMT204",
    "MMT205",
    "MMT301",
    "MMT302",
    "MMT303",
    "MMT304",
    "MMT305",
    "MMT306",
    "MMT307",
    "MMT308",
    "MMT309",
    "MMT310",
    "MMT311",
    "MMT312",
    "MMT313",
}


def course_codes_for_program(program: str) -> set[str]:
    if program == "ATTT":
        return COMMON_COURSES | ATTT_ONLY_COURSES
    if program == "MMTTTDL":
        return COMMON_COURSES | MMT_ONLY_COURSES
    return set()


def course_group(course_code: str) -> str:
    term = COURSE_TERM_BY_CODE.get(course_code.upper(), 99)
    if term <= 2:
        return "Đại cương"
    if term <= 4:
        return "Cơ sở ngành"
    if term <= 7:
        return "Chuyên ngành"
    return "Tốt nghiệp"


def identify_program(class_code: str) -> dict[str, str]:
    if re.fullmatch(r"ATTN20\d{2}", class_code, re.IGNORECASE):
        return {
            "program": "ATTT",
            "programName": "An toàn thông tin",
            "trainingSystem": "Tài năng",
            "evidence": f"Mã lớp {class_code} khớp mẫu ATTN20xx của ngành ATTT hệ Tài năng.",
        }
    if re.fullmatch(r"ATTT20\d{2}(?:\.\d+)?", class_code, re.IGNORECASE):
        return {
            "program": "ATTT",
            "programName": "An toàn thông tin",
            "trainingSystem": "Đại trà",
            "evidence": f"Mã lớp {class_code} khớp mẫu ATTT20xx(.nhóm) của ngành ATTT hệ Đại trà.",
        }
    if re.fullmatch(r"(?:MMTT|MMT&TT)20\d{2}(?:\.\d+)?", class_code, re.IGNORECASE):
        return {
            "program": "MMTTTDL",
            "programName": "Mạng máy tính và Truyền thông dữ liệu",
            "trainingSystem": "Đại trà",
            "evidence": f"Mã lớp {class_code} khớp mẫu MMT&TT20xx(.nhóm) của ngành MMT&TTDL hệ Đại trà.",
        }
    return {
        "program": "UNKNOWN",
        "programName": "Không xác định",
        "trainingSystem": "Không xác định",
        "evidence": f"Mã lớp {class_code} chưa khớp policy nhận diện ngành.",
    }


def term_order(term_code: str) -> int:
    match = re.search(r"\d+", term_code or "")
    return int(match.group(0)) if match else 999


def passed_by_policy(row: dict[str, Any]) -> bool:
    letter = str(row.get("letter_grade") or "").upper()
    if letter in {"MIEN", "MIỄN", "EXEMPT"}:
        return True
    return letter != "F" and float(row.get("final_score") or 0) >= 5


def failed_by_policy(row: dict[str, Any]) -> bool:
    letter = str(row.get("letter_grade") or "").upper()
    if letter in {"MIEN", "MIỄN", "EXEMPT"}:
        return False
    return letter == "F" or float(row.get("final_score") or 0) < 5


def is_graduation_work(row: dict[str, Any]) -> bool:
    course_code = str(row.get("course_code") or "").upper()
    course_name = normalize_text(str(row.get("course_name") or ""))
    return course_code in GRADUATION_WORK_CODES or "khoa luan" in course_name or "chuyen de tot nghiep" in course_name


def standard_cumulative_credits(program: str, term_index: int) -> int:
    codes = course_codes_for_program(program)
    if not codes:
        return 0
    course_rows = query(
        """
        SELECT course_code, credits
        FROM courses
        WHERE course_code = ANY(%s)
        """,
        (list(codes),),
    )
    return sum(
        int(row["credits"])
        for row in course_rows
        if COURSE_TERM_BY_CODE.get(row["course_code"].upper(), 99) <= term_index
    )


def curriculum_courses(program: str) -> list[dict[str, Any]]:
    codes = course_codes_for_program(program)
    if not codes:
        return []
    rows = query(
        """
        SELECT course_code, course_name, credits
        FROM courses
        WHERE course_code = ANY(%s)
        ORDER BY course_code
        """,
        (list(codes),),
    )
    return [
        {
            "code": row["course_code"],
            "name": row["course_name"],
            "credits": int(row["credits"]),
            "group": course_group(row["course_code"]),
            "term": COURSE_TERM_BY_CODE.get(row["course_code"].upper(), 99),
        }
        for row in rows
    ]


RISK_SQL = """
WITH course_state AS (
  SELECT
    s.id AS student_id,
    cr.course_code,
    cr.credits,
    BOOL_OR(e.passed) AS has_passed,
    BOOL_OR(e.passed = FALSE OR e.final_score < 5) AS has_failed,
    MIN(e.final_score) AS min_score
  FROM students s
  LEFT JOIN enrollments e ON e.student_id = s.id
  LEFT JOIN course_offerings co ON co.id = e.course_offering_id
  LEFT JOIN courses cr ON cr.id = co.course_id
	  GROUP BY s.id, cr.course_code, cr.credits
	),
term_state AS (
  SELECT
    s.id AS student_id,
    COALESCE(
      MAX(
        CASE
          WHEN t.term_code ~ '^HK[0-9]+$' THEN REGEXP_REPLACE(t.term_code, '[^0-9]', '', 'g')::int
          ELSE 0
        END
      ),
      0
    ) AS latest_term_index
  FROM students s
  LEFT JOIN enrollments e ON e.student_id = s.id
  LEFT JOIN course_offerings co ON co.id = e.course_offering_id
  LEFT JOIN terms t ON t.id = co.term_id
  GROUP BY s.id
),
student_metrics AS (
	  SELECT
	    s.id,
    s.mssv,
    s.full_name,
    s.academic_status,
    c.class_code,
	    c.required_credits,
	    COALESCE(ts.latest_term_index, 0)::int AS latest_term_index,
	    COALESCE(s.current_gpa, 0)::float AS current_gpa,
	    COALESCE(SUM(CASE WHEN cs.has_passed THEN cs.credits ELSE 0 END), 0)::float AS completed_credits,
    COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN cs.credits ELSE 0 END), 0)::float AS debt_credits,
    COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN 1 ELSE 0 END), 0)::int AS failed_courses,
    COALESCE(SUM(CASE WHEN cs.min_score < 5 THEN 1 ELSE 0 END), 0)::int AS low_score_courses
	  FROM students s
	  JOIN classes c ON c.id = s.class_id
	  LEFT JOIN course_state cs ON cs.student_id = s.id
	  LEFT JOIN term_state ts ON ts.student_id = s.id
	  GROUP BY s.id, c.class_code, c.required_credits, ts.latest_term_index
	),
risk AS (
	  SELECT
	    *,
    CASE
      WHEN required_credits > 0 THEN completed_credits / required_credits
      ELSE 0
    END AS completion_ratio,
    CASE
      WHEN required_credits > 0 AND completed_credits >= required_credits THEN 'graduated'
      ELSE academic_status
    END AS effective_academic_status,
    CASE
      WHEN required_credits > 0 AND completed_credits >= required_credits THEN 0
      ELSE LEAST(
        100,
        ROUND(
          (
	            LEAST(1, GREATEST(0, (5 - current_gpa) / 5.0)) * 45 +
	            LEAST(1, GREATEST(0, (70 - ((completed_credits / NULLIF(required_credits, 0)) * 100)) / 70.0)) * 30 +
	            LEAST(
	              CASE
	                WHEN required_credits > 0
	                  AND completed_credits >= required_credits - 10
	                  AND debt_credits = 0
	                THEN 0
	                ELSE GREATEST(0, LEAST(required_credits, latest_term_index * 17) - completed_credits)
	              END,
	              34
	            ) * 2.2 +
	            LEAST(debt_credits, 30) * 0.9 +
	            LEAST(failed_courses, 4) * 5 +
	            LEAST(low_score_courses, 4) * 3
          )::numeric,
          1
        )
      )
    END AS delay_risk_score
  FROM student_metrics
)
SELECT
  id,
  mssv,
  full_name,
  effective_academic_status AS academic_status,
  class_code,
  current_gpa,
  latest_term_index,
  completed_credits,
  required_credits,
  debt_credits,
  completion_ratio,
  failed_courses,
  low_score_courses,
  delay_risk_score
FROM risk
"""


def summarize_risk_band(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def summarize_quadrant(completion_ratio: float, current_gpa: float) -> str:
    if completion_ratio < 0.5 and current_gpa < 5:
        return "urgent"
    if completion_ratio < 0.5:
        return "credit-watch"
    if current_gpa < 5:
        return "gpa-watch"
    return "healthy"


def recommend_action(score: float, failed_courses: int, low_score_courses: int) -> str:
    if score >= 75:
        return "Hẹn gặp ngay trong 72 giờ, lập kế hoạch học lại và theo dõi hằng tuần."
    if failed_courses >= 2:
        return "Hẹn buổi cố vấn trong 7 ngày, theo dõi điểm thành phần và cảnh báo sớm."
    if low_score_courses >= 2:
        return "Khuyến nghị ôn tập có hướng dẫn và kiểm tra tiến độ mỗi 2 tuần."
    return "Tiếp tục duy trì, khuyến khích tham gia hoạt động học thuật."


def compact_risk_row(student: dict[str, Any]) -> dict[str, Any]:
    return {
        "MSSV": student["mssv"],
        "Họ tên": student["fullName"],
        "Lớp": student["classCode"],
        "GPA": student["currentGpa"],
        "Hoàn thành tín chỉ": student["completedCredits"],
        "Môn rớt chưa học lại": student["debtCredits"],
        "Mức rủi ro (%)": student["delayRiskScore"],
        "Nhóm rủi ro": student["riskBand"],
        "Khuyến nghị": student["recommendedAction"],
    }


def fetch_risk_students(
    user: CurrentUser, class_code: str | None = None
) -> list[dict[str, Any]]:
    class_rows = get_accessible_classes(user)
    allowed_codes = [row["class_code"] for row in class_rows]
    if not allowed_codes:
        return []
    if class_code and class_code not in allowed_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Forbidden class scope: {class_code}",
        )

    sql = (
        "WITH risk AS (" + RISK_SQL + ") "
        "SELECT * FROM risk WHERE class_code = ANY(%s)"
    )
    params: list[Any] = [allowed_codes]
    if class_code:
        sql += " AND class_code = %s"
        params.append(class_code)
    sql += " ORDER BY delay_risk_score DESC, current_gpa ASC, mssv"

    rows = query(sql, tuple(params))
    enriched: list[dict[str, Any]] = []
    for row in rows:
        completion_ratio = float(row["completion_ratio"] or 0)
        current_gpa = float(row["current_gpa"] or 0)
        score = float(row["delay_risk_score"] or 0)
        failed_courses = int(row["failed_courses"] or 0)
        low_score_courses = int(row["low_score_courses"] or 0)
        academic_status = row.get("academic_status")
        enriched.append(
            {
                "id": row["id"],
                "mssv": row["mssv"],
                "fullName": row["full_name"],
                "classCode": row["class_code"],
                "academicStatus": academic_status,
                "currentGpa": round(current_gpa, 2),
                "latestTermIndex": int(row["latest_term_index"] or 0),
                "completedCredits": float(row["completed_credits"] or 0),
                "requiredCredits": float(row["required_credits"] or 0),
                "debtCredits": float(row["debt_credits"] or 0),
                "completionRatio": round(completion_ratio * 100, 2),
                "failedCourses": failed_courses,
                "lowScoreCourses": low_score_courses,
                "delayRiskScore": round(score, 1),
                "riskBand": summarize_risk_band(score),
                "quadrant": summarize_quadrant(completion_ratio, current_gpa),
                "recommendedAction": (
                    "Đã tốt nghiệp, lưu hồ sơ theo dõi cựu sinh viên."
                    if academic_status == "graduated"
                    else recommend_action(score, failed_courses, low_score_courses)
                ),
            }
        )
    return enriched


def get_provider_settings(provider: str) -> dict[str, str]:
    if provider == "gemini":
        return {
            "api_key": GEMINI_API_KEY or LLM_API_KEY,
            "model": GEMINI_MODEL or LLM_MODEL or "gemini-2.0-flash",
            "base_url": "",
        }
    return {
        "api_key": OPENAI_API_KEY or LLM_API_KEY,
        "model": OPENAI_MODEL or LLM_MODEL or "gpt-5.4",
        "base_url": OPENAI_BASE_URL or LLM_BASE_URL,
    }


def resolve_llm(provider: str):
    if not LANGCHAIN_AVAILABLE:
        return None
    settings = get_provider_settings(provider)
    api_key = settings["api_key"]
    if not api_key:
        return None
    if provider == "gemini":
        return ChatGoogleGenerativeAI(
            model=settings["model"], google_api_key=api_key, temperature=0
        )
    kwargs: dict[str, Any] = {
        "model": settings["model"],
        "api_key": api_key,
        "temperature": 0,
    }
    if settings["base_url"]:
        kwargs["base_url"] = settings["base_url"]
    return ChatOpenAI(**kwargs)


def provider_order() -> list[str]:
    return ["gemini", "openai"] if LLM_PROVIDER == "gemini" else ["openai", "gemini"]


def should_fallback(provider: str, exc: Exception) -> bool:
    if provider != "gemini":
        return False
    message = str(exc).lower()
    fallback_signals = [
        "api key",
        "invalid",
        "permission",
        "quota",
        "rate limit",
        "resource exhausted",
        "unavailable",
        "not found",
        "unsupported",
        "deadline exceeded",
        "timed out",
        "service unavailable",
    ]
    return any(signal in message for signal in fallback_signals)


def llm_json(system_prompt: str, user_prompt: str) -> dict[str, Any] | None:
    for index, provider in enumerate(provider_order()):
        model = resolve_llm(provider)
        if not model:
            continue
        try:
            response = model.invoke(
                [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_prompt),
                ]
            )
            text = getattr(response, "content", "")
            if isinstance(text, list):
                text = "".join(
                    chunk.get("text", "") for chunk in text if isinstance(chunk, dict)
                )
            if not isinstance(text, str):
                continue
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                continue
            return json.loads(match.group(0))
        except Exception as exc:
            if index == len(provider_order()) - 1 or not should_fallback(provider, exc):
                continue
    return None


def extract_class_code_from_message(message: str, class_codes: list[str]) -> str | None:
    upper = message.upper()
    for code in class_codes:
        if code.upper() in upper:
            return code

    if len(class_codes) == 1:
        return class_codes[0]

    pattern_matches = re.findall(r"\b[A-Z][A-Z0-9&\.]*\d{4}(?:\.\d+)?\b", message)
    for match in pattern_matches:
        for code in class_codes:
            if match.upper() == code.upper():
                return code

    return None


def extract_course(message: str) -> dict[str, str | None]:
    normalized = normalize_text(message)
    courses = query("SELECT course_code, course_name FROM courses ORDER BY course_name")
    for course in courses:
        course_name = normalize_text(course["course_name"])
        if course_name and course_name in normalized:
            return {
                "courseCode": course["course_code"],
                "courseName": course["course_name"],
            }
        if course["course_code"].lower() in normalized:
            return {
                "courseCode": course["course_code"],
                "courseName": course["course_name"],
            }
    return {"courseCode": None, "courseName": None}


def find_student_for_chat(
    user: CurrentUser, params: dict[str, Any], message: str
) -> dict[str, Any] | None:
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    class_code = (
        params.get("classCode")
        or params.get("class_code")
        or params.get("class")
        or params.get("lop")
        or params.get("lớp")
    )
    if class_code and class_code in allowed_codes:
        allowed_codes = [class_code]
    if not allowed_codes:
        return None

    mssv = (
        params.get("mssv")
        or params.get("MSSV")
        or params.get("studentId")
        or params.get("student_id")
    )
    if not mssv:
        mssv_match = re.search(r"\b\d{8}\b", message)
        mssv = mssv_match.group(0) if mssv_match else None

    if mssv:
        return query_one(
            """
            SELECT
              s.id::text,
              s.mssv,
              s.full_name,
              s.current_gpa::float AS current_gpa,
              s.academic_status,
              cl.class_code,
              cl.required_credits::int AS required_credits
            FROM students s
            JOIN classes cl ON cl.id = s.class_id
            WHERE s.mssv = %s AND cl.class_code = ANY(%s)
            """,
            (str(mssv), allowed_codes),
        )

    requested_name = (
        params.get("studentName")
        or params.get("student_name")
        or params.get("name")
        or params.get("fullName")
        or ""
    )
    haystack = normalize_text(f"{message} {requested_name}")
    students = query(
        """
        SELECT
          s.id::text,
          s.mssv,
          s.full_name,
          s.current_gpa::float AS current_gpa,
          s.academic_status,
          cl.class_code,
          cl.required_credits::int AS required_credits
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        WHERE cl.class_code = ANY(%s)
        ORDER BY LENGTH(s.full_name) DESC, s.full_name
        """,
        (allowed_codes,),
    )
    for student in students:
        normalized_name = normalize_text(student["full_name"])
        if normalized_name and normalized_name in haystack:
            return student

    message_tokens = set(haystack.split())
    best_student: dict[str, Any] | None = None
    best_score = 0
    for student in students:
        name_tokens = set(normalize_text(student["full_name"]).split())
        if not name_tokens:
            continue
        score = len(name_tokens & message_tokens)
        if score > best_score and score >= min(3, len(name_tokens)):
            best_student = student
            best_score = score
    return best_student


def exact_student_name_matches_for_chat(
    user: CurrentUser, params: dict[str, Any], message: str
) -> list[dict[str, Any]]:
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    class_code = (
        params.get("classCode")
        or params.get("class_code")
        or params.get("class")
        or params.get("lop")
        or params.get("lớp")
    )
    if class_code and class_code in allowed_codes:
        allowed_codes = [class_code]
    if not allowed_codes:
        return []

    requested_name = (
        params.get("studentName")
        or params.get("student_name")
        or params.get("name")
        or params.get("fullName")
        or ""
    )
    haystack = normalize_text(f"{message} {requested_name}")
    students = query(
        """
        SELECT
          s.id::text,
          s.mssv,
          s.full_name,
          s.current_gpa::float AS current_gpa,
          s.academic_status,
          cl.class_code,
          cl.required_credits::int AS required_credits
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        WHERE cl.class_code = ANY(%s)
        ORDER BY s.full_name, s.mssv
        """,
        (allowed_codes,),
    )
    return [
        student
        for student in students
        if normalize_text(student["full_name"])
        and normalize_text(student["full_name"]) in haystack
    ]


def build_rule_based_plan(
    message: str, class_codes: list[str] | None = None
) -> dict[str, Any]:
    normalized = normalize_text(message)
    class_code = extract_class_code_from_message(message, class_codes or [])
    course = extract_course(message)
    limit_match = re.search(r"\btop\s*(\d+)\b", normalized) or re.search(
        r"\b(\d+)\s+(?:ban|sinh vien|sv)\b", normalized
    )
    limit = int(limit_match.group(1)) if limit_match else 5

    if any(token in normalized for token in ["bang diem", "transcript", "lich su diem", "diem cac mon"]):
        return {"tool": "student_transcript", "params": {"classCode": class_code}}

    if any(
        token in normalized
        for token in [
            "ho so sinh vien", "thong tin sinh vien", "ho so sv", "thong tin sv",
            "profile sinh vien", "tinh hinh hoc tap", "ket qua hoc tap",
            "hoc luc", "tinh trang hoc",
        ]
    ):
        return {"tool": "student_profile", "params": {"classCode": class_code}}

    if any(
        token in normalized
        for token in [
            "tong quan lop",
            "thong ke lop",
            "tom tat lop",
            "summary lop",
            "thong tin lop",
        ]
    ):
        return {"tool": "class_summary", "params": {"classCode": class_code}}

    if (course["courseCode"] or course["courseName"]) and any(
        token in normalized
        for token in ["ai rot", "rot mon", "sinh vien rot", "sv rot", "danh sach rot"]
    ):
        return {
            "tool": "course_failures",
            "params": {**course, "classCode": class_code},
        }

    if any(
        token in normalized
        for token in [
            "sap tot nghiep",
            "gan tot nghiep",
            "tot nghiep som",
            "ra truong som",
            "sap ra truong",
        ]
    ):
        return {"tool": "near_graduation", "params": {"classCode": class_code, "limit": limit if limit_match else 10}}

    if any(
        token in normalized
        for token in [
            "mon rot nhieu",
            "ti le rot",
            "ty le rot",
            "mon kho",
            "mon nhieu sinh vien rot",
            "mon nao rot",
        ]
    ):
        return {"tool": "most_failed_courses", "params": {"classCode": class_code, "limit": limit}}

    if any(token in normalized for token in ["nhan xet", "danh gia", "review", "phan tich sinh vien"]):
        return {"tool": "student_comment", "params": {"classCode": class_code}}

    if (course["courseCode"] or course["courseName"]) and any(
        token in normalized
        for token in [
            "cao nhat",
            "thap nhat",
            "top",
            "diem mon",
            "diem cao",
            "diem thap",
            "xep hang",
        ]
    ):
        return {
            "tool": "top_course_scores",
            "params": {**course, "classCode": class_code, "limit": limit},
        }

    if any(token in normalized for token in ["ve", "bieu do", "pho diem", "histogram", "phan bo", "phan phoi"]):
        return {
            "tool": "grade_distribution",
            "params": {**course, "classCode": class_code},
        }
    if ("top" in normalized and "gpa" in normalized) or any(
        token in normalized
        for token in [
            "tot nhat",
            "xuat sac nhat",
            "thanh tich tot nhat",
            "thanh tich cao nhat",
        ]
    ):
        return {
            "tool": "top_students",
            "params": {"classCode": class_code, "limit": limit},
        }
    if any(token in normalized for token in ["gpa thap", "diem thap", "gpa toi thieu", "thanh tich thap"]):
        return {
            "tool": "low_gpa_students",
            "params": {"classCode": class_code, "limit": limit},
        }
    if any(token in normalized for token in ["nguy co", "rot mon", "canh bao"]) and (
        course["courseCode"] or course["courseName"]
    ):
        return {
            "tool": "at_risk_students",
            "params": {**course, "classCode": class_code},
        }
    if any(token in normalized for token in ["tong quan", "rui ro", "hoc vu"]):
        return {"tool": "risk_overview", "params": {"classCode": class_code}}

    # If the message mentions a specific student name or MSSV, route to student_profile
    has_mssv = bool(re.search(r"\b\d{8}\b", message))
    
    name_candidates = []
    current_name = []
    exclude_terms = {"lop", "mon", "giao", "vien", "sinh", "vien", "viet", "nam", "tinh", "hinh", "phan", "bo", "diem", "so", "nhap"}
    if course["courseName"]:
        exclude_terms.update(normalize_text(course["courseName"]).split())
    if class_code:
        exclude_terms.add(normalize_text(class_code))

    for w in message.split():
        clean_w = "".join(c for c in w if c.isalpha())
        if clean_w and clean_w.istitle() and normalize_text(clean_w) not in exclude_terms:
            current_name.append(clean_w)
        else:
            if len(current_name) >= 2:
                name_candidates.append(" ".join(current_name))
            current_name = []
    if len(current_name) >= 2:
        name_candidates.append(" ".join(current_name))
        
    has_student_name = bool(name_candidates) or has_mssv
    if has_student_name:
        return {"tool": "student_profile", "params": {"classCode": class_code}}

    return {"tool": "risk_overview", "params": {"classCode": class_code}}


def normalize_llm_plan(
    plan: dict[str, Any] | None,
    message: str,
    class_codes: list[str] | None = None,
) -> dict[str, Any] | None:
    if not isinstance(plan, dict):
        return None
    allowed_tools = {
        "top_students",
        "low_gpa_students",
        "at_risk_students",
        "grade_distribution",
        "risk_overview",
        "student_comment",
        "top_course_scores",
        "student_profile",
        "student_transcript",
        "class_summary",
        "course_failures",
        "near_graduation",
        "most_failed_courses",
    }
    tool = plan.get("tool")
    params = plan.get("params")
    if tool not in allowed_tools or not isinstance(params, dict):
        return None

    normalized_params = dict(params)
    class_code = (
        normalized_params.get("classCode")
        or normalized_params.get("class_code")
        or normalized_params.get("class")
        or normalized_params.get("lop")
        or normalized_params.get("lớp")
        or extract_class_code_from_message(message, class_codes or [])
    )
    if class_code:
        normalized_params["classCode"] = class_code

    course = extract_course(message)
    if course["courseCode"] and not normalized_params.get("courseCode"):
        normalized_params["courseCode"] = course["courseCode"]
    if course["courseName"] and not normalized_params.get("courseName"):
        normalized_params["courseName"] = course["courseName"]

    student_name = (
        normalized_params.get("studentName")
        or normalized_params.get("student_name")
        or normalized_params.get("fullName")
        or normalized_params.get("name")
    )
    if student_name:
        normalized_params["studentName"] = student_name
    student_id = (
        normalized_params.get("mssv")
        or normalized_params.get("MSSV")
        or normalized_params.get("studentId")
        or normalized_params.get("student_id")
    )
    if student_id:
        normalized_params["mssv"] = str(student_id)

    limit = normalized_params.get("limit")
    try:
        normalized_params["limit"] = max(1, min(int(limit), 50)) if limit is not None else 5
    except (TypeError, ValueError):
        normalized_params["limit"] = 5

    return {"tool": tool, "params": normalized_params}


def plan_chat_query(
    message: str, class_codes: list[str] | None = None
) -> dict[str, Any]:
    normalized = normalize_text(message)
    rule_fallback = build_rule_based_plan(message, class_codes)

    llm_plan = llm_json(
        (
            "Bạn là bộ lập kế hoạch truy vấn dữ liệu học vụ UIT cho hệ thống CVHT. "
            "Chỉ trả về JSON hợp lệ, không giải thích, không markdown. "
            'Schema bắt buộc: {"tool": string, "params": object}. '
            "tool chỉ được là: top_students, low_gpa_students, at_risk_students, "
            "grade_distribution, risk_overview, student_comment, top_course_scores, "
            "student_profile, student_transcript, class_summary, course_failures, "
            "near_graduation, most_failed_courses. "
            "Quy ước params: classCode, courseCode, courseName, limit, studentName, mssv. "
            "top_students dùng cho GPA cao nhất/thành tích tốt nhất. "
            "top_course_scores dùng cho xếp hạng điểm cao nhất/thấp nhất của một môn cụ thể, ví dụ ENG03. "
            "low_gpa_students dùng cho GPA thấp nhất/thành tích kém. "
            "at_risk_students dùng cho nguy cơ học vụ/rớt môn/cảnh báo. "
            "grade_distribution dùng cho phổ điểm/biểu đồ điểm/histogram của môn. "
            "risk_overview dùng cho tổng quan rủi ro học vụ. "
            "student_comment dùng khi người dùng muốn nhận xét/đánh giá/tóm tắt một sinh viên theo tên hoặc MSSV. "
            "student_profile dùng khi muốn xem hồ sơ/thông tin tổng hợp của một sinh viên (GPA, tín chỉ, tiến độ). "
            "student_transcript dùng khi muốn xem bảng điểm/lịch sử điểm chi tiết của một sinh viên. "
            "class_summary dùng khi muốn tổng quan/thống kê một lớp (sĩ số, GPA TB, phân bố). "
            "course_failures dùng khi muốn liệt kê sinh viên đã rớt một môn cụ thể. "
            "near_graduation dùng khi muốn tìm sinh viên sắp tốt nghiệp (≥80% tín chỉ). "
            "most_failed_courses dùng khi muốn biết môn nào tỉ lệ rớt cao nhất. "
            "Nếu câu hỏi có mã lớp hoặc tên môn, đưa vào params chính xác."
        ),
        message,
    )
    normalized_llm_plan = normalize_llm_plan(llm_plan, message, class_codes)
    if normalized_llm_plan:
        if rule_fallback["tool"] in {
            "student_comment",
            "top_course_scores",
            "student_profile",
            "student_transcript",
            "class_summary",
            "course_failures",
            "near_graduation",
            "most_failed_courses",
        }:
            return rule_fallback
        if any(
            token in normalized for token in ["ve", "bieu do", "pho diem", "histogram", "phan bo", "phan phoi"]
        ):
            params = dict(normalized_llm_plan["params"])
            params.update({k: v for k, v in rule_fallback["params"].items() if v})
            return {"tool": "grade_distribution", "params": params}
        return normalized_llm_plan
    return rule_fallback


def small_talk_answer(message: str) -> str | None:
    normalized = normalize_text(message)
    cleaned = re.sub(r"[^a-z0-9\s]", " ", normalized)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None

    data_keywords = [
        "sinh vien",
        "mssv",
        "lop",
        "gpa",
        "diem",
        "tin chi",
        "hoc vu",
        "rui ro",
        "canh bao",
        "mon",
        "pho diem",
        "bieu do",
        "top",
        "thong ke",
        "tong quan",
    ]
    if any(keyword in cleaned for keyword in data_keywords):
        return None

    greeting_phrases = {
        "hi",
        "hello",
        "hey",
        "alo",
        "xin chao",
        "chao",
        "chao ban",
        "xin chao ban",
    }
    thanks_phrases = {"cam on", "thanks", "thank you", "ok", "oke", "duoc roi"}
    identity_phrases = {"ban la ai", "may la ai", "tro ly nay la gi"}

    word_count = len(cleaned.split())
    if cleaned in greeting_phrases or (
        word_count <= 4 and any(phrase in cleaned for phrase in greeting_phrases)
    ):
        return "Xin chào! Mình đang sẵn sàng hỗ trợ."
    if cleaned in thanks_phrases or (
        word_count <= 4 and any(phrase in cleaned for phrase in thanks_phrases)
    ):
        return "Rất vui được hỗ trợ bạn."
    if cleaned in identity_phrases:
        return "Mình là trợ lý AI học vụ của hệ thống CVHT."
    return None


def build_llm_brief_payload(
    class_code: str, students: list[dict[str, Any]], metrics: dict[str, Any]
) -> str:
    top = students[0] if students else None
    return json.dumps(
        {
            "classCode": class_code,
            "metrics": metrics,
            "topRiskStudent": top["fullName"] if top else None,
            "topRiskScore": top["delayRiskScore"] if top else None,
        },
        ensure_ascii=False,
    )


def llm_brief(payload: str) -> str | None:
    response = llm_json(
        (
            "Ban la tro ly AI hoc vu viet brief ngan, ro, thuc dung. "
            'Tra ve JSON dang {"summary": "..."} bang tieng Viet, toi da 2 cau.'
        ),
        payload,
    )
    if isinstance(response, dict) and isinstance(response.get("summary"), str):
        return response["summary"]
    return None


def grade_distribution_rows(
    course_code: str | None,
    course_name: str | None,
    class_code: str | None,
    allowed_codes: list[str],
) -> dict[str, Any]:
    if not course_code and not course_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can chi ro mon hoc de ve pho diem",
        )

    sql = """
    SELECT
      CASE
        WHEN FLOOR(e.final_score)::int >= 10 THEN '10'
        ELSE CONCAT(FLOOR(e.final_score)::int, '-', FLOOR(e.final_score)::int + 0.9)
      END AS bin,
      FLOOR(e.final_score)::int AS sort_key,
      COUNT(*)::int AS count
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN classes cl ON cl.id = s.class_id
    JOIN course_offerings co ON co.id = e.course_offering_id
    JOIN courses c ON c.id = co.course_id
    WHERE cl.class_code = ANY(%s)
    """
    params: list[Any] = [allowed_codes]
    if class_code:
        sql += " AND cl.class_code = %s"
        params.append(class_code)
    if course_code:
        sql += " AND c.course_code = %s"
        params.append(course_code)
    elif course_name:
        sql += " AND LOWER(c.course_name) = LOWER(%s)"
        params.append(course_name)
    sql += " GROUP BY FLOOR(e.final_score) ORDER BY FLOOR(e.final_score)"
    rows = query(sql, tuple(params))
    rows = [{"bin": row["bin"], "count": row["count"]} for row in rows]
    answer = f"Phổ điểm môn {course_name or course_code} có {sum(int(row['count']) for row in rows)} lượt ghi nhận."
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "bar_chart", "xKey": "bin", "yKey": "count"},
        "sqlPreview": f"-- Pho diem mon {course_name or course_code}",
    }


def top_course_scores_rows(
    course_code: str | None,
    course_name: str | None,
    class_code: str | None,
    allowed_codes: list[str],
    limit: int,
) -> dict[str, Any]:
    if not course_code and not course_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can chi ro mon hoc de xep hang diem",
        )

    sql = """
    WITH ranked_scores AS (
      SELECT
        s.mssv,
        s.full_name,
        cl.class_code,
        c.course_code,
        c.course_name,
        COALESCE(e.overall_score, e.final_score)::float AS score,
        e.letter_grade,
        ROW_NUMBER() OVER (
          PARTITION BY s.id
          ORDER BY COALESCE(e.overall_score, e.final_score) DESC,
                   CASE
                     WHEN t.term_code ~ '^HK[0-9]+$'
                       THEN REGEXP_REPLACE(t.term_code, '[^0-9]', '', 'g')::int
                     ELSE 0
                   END DESC,
                   e.attempt_no DESC
        ) AS rn
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN classes cl ON cl.id = s.class_id
      JOIN course_offerings co ON co.id = e.course_offering_id
      JOIN courses c ON c.id = co.course_id
      JOIN terms t ON t.id = co.term_id
      WHERE cl.class_code = ANY(%s)
    """
    query_params: list[Any] = [allowed_codes]
    if class_code:
        sql += " AND cl.class_code = %s"
        query_params.append(class_code)
    if course_code:
        sql += " AND c.course_code = %s"
        query_params.append(course_code)
    elif course_name:
        sql += " AND LOWER(c.course_name) = LOWER(%s)"
        query_params.append(course_name)
    sql += """
    )
    SELECT *
    FROM ranked_scores
    WHERE rn = 1
    ORDER BY score DESC, mssv
    LIMIT %s
    """
    query_params.append(max(1, min(limit, 50)))
    raw_rows = query(sql, tuple(query_params))
    rows = [
        {
            "MSSV": row["mssv"],
            "Họ tên": row["full_name"],
            "Lớp": row["class_code"],
            "Mã môn": row["course_code"],
            "Học phần": row["course_name"],
            "Điểm": round(float(row["score"] or 0), 2),
            "Chữ": row["letter_grade"],
        }
        for row in raw_rows
    ]

    subject = rows[0]["Học phần"] if rows else (course_name or course_code)
    scope = f" lớp {class_code}" if class_code else ""
    if rows:
        answer = (
            f"Top {len(rows)} sinh viên có điểm {subject} cao nhất{scope}: "
            f"{rows[0]['Họ tên']} đạt {rows[0]['Điểm']}."
        )
    else:
        answer = f"Mình chưa thấy điểm {subject}{scope} trong dữ liệu hiện có."

    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": f"-- Top diem mon {course_name or course_code}",
    }


def student_comment_result(
    user: CurrentUser, params: dict[str, Any], message: str
) -> dict[str, Any]:
    has_student_id = any(
        params.get(key) for key in ["mssv", "MSSV", "studentId", "student_id"]
    ) or bool(re.search(r"\b\d{8}\b", message))
    exact_matches = exact_student_name_matches_for_chat(user, params, message)
    if not has_student_id and len(exact_matches) > 1:
        rows = [
            {
                "MSSV": row["mssv"],
                "Họ tên": row["full_name"],
                "Lớp": row["class_code"],
                "GPA hiện tại": round(float(row["current_gpa"] or 0), 2),
            }
            for row in exact_matches[:10]
        ]
        return {
            "answer": (
                f"Mình thấy {len(exact_matches)} sinh viên trùng tên. "
                "Bạn chọn đúng MSSV hoặc nói thêm lớp để mình nhận xét chính xác nhé."
            ),
            "rows": rows,
            "visualization": {"type": "table"},
            "sqlPreview": "-- Danh sach sinh vien trung ten",
        }

    student = find_student_for_chat(user, params, message)
    if not student:
        return {
            "answer": "Mình chưa xác định được sinh viên bạn muốn nhận xét. Bạn gửi thêm MSSV hoặc họ tên đầy đủ nhé.",
            "rows": [],
            "visualization": {"type": "none"},
            "sqlPreview": "-- Nhan xet sinh vien",
        }

    risk_students = fetch_risk_students(user, student["class_code"])
    risk = next((item for item in risk_students if item["mssv"] == student["mssv"]), None)
    profile = student_profile_data(student["mssv"]) or student
    completed = float(risk["completedCredits"] if risk else 0)
    required = float(risk["requiredCredits"] if risk else profile.get("required_credits") or 0)
    debt = float(risk["debtCredits"] if risk else 0)
    gpa = round(float(profile.get("current_gpa") or 0), 2)
    status = profile.get("academic_status") or student.get("academic_status")
    if required > 0 and completed >= required:
        status_label = "đã đủ điều kiện tốt nghiệp"
    elif debt > 0:
        status_label = "cần ưu tiên xử lý môn rớt chưa học lại"
    elif gpa >= 8:
        status_label = "có nền tảng học tập rất tốt"
    elif gpa >= 6.5:
        status_label = "đang ở mức ổn định"
    else:
        status_label = "cần được theo dõi sát hơn"

    summary_payload = {
        "fullName": profile["full_name"],
        "mssv": profile["mssv"],
        "classCode": profile["class_code"],
        "currentGpa": gpa,
        "completedCredits": completed,
        "requiredCredits": required,
        "debtCredits": debt,
        "riskScore": risk["delayRiskScore"] if risk else None,
        "riskBand": risk["riskBand"] if risk else None,
        "academicStatus": status,
        "recommendedAction": risk["recommendedAction"] if risk else None,
    }
    llm_comment = llm_json(
        (
            "Bạn là cố vấn học tập UIT. Viết nhận xét ngắn gọn, tự nhiên, không máy móc. "
            "Chỉ trả về JSON hợp lệ dạng {\"summary\":\"...\"}. "
            "Nhận xét tối đa 3 câu, nêu điểm mạnh, rủi ro nếu có và gợi ý theo dõi."
        ),
        json.dumps(summary_payload, ensure_ascii=False),
    )
    answer = None
    if isinstance(llm_comment, dict) and isinstance(llm_comment.get("summary"), str):
        answer = llm_comment["summary"].strip()
    if not answer:
        answer = (
            f"{profile['full_name']} ({profile['mssv']}) hiện có GPA {gpa}, "
            f"hoàn thành {completed:g}/{required:g} tín chỉ và {status_label}."
        )
        if risk and risk.get("recommendedAction"):
            answer += f" Gợi ý: {risk['recommendedAction']}"

    rows = [
        {
            "MSSV": profile["mssv"],
            "Họ tên": profile["full_name"],
            "Lớp": profile["class_code"],
            "GPA hiện tại": gpa,
            "Hoàn thành tín chỉ": f"{completed:g}/{required:g}",
            "Môn rớt chưa học lại": debt,
            "Rủi ro (%)": risk["delayRiskScore"] if risk else 0,
            "Trạng thái": status_label,
        }
    ]
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Nhan xet sinh vien theo ho so hoc vu",
    }


def student_profile_rows(
    user: CurrentUser, params: dict[str, Any], message: str
) -> dict[str, Any]:
    student = find_student_for_chat(user, params, message)
    if not student:
        return {
            "answer": "Mình chưa xác định được sinh viên bạn muốn xem hồ sơ. Bạn gửi MSSV hoặc họ tên đầy đủ nhé.",
            "rows": [],
            "visualization": {"type": "none"},
            "sqlPreview": "-- Khong tim thay sinh vien",
        }
    stats = query_one(
        """
        SELECT
          COALESCE(SUM(c.credits), 0)::float AS attempted_credits,
          COALESCE(SUM(CASE WHEN e.passed THEN c.credits ELSE 0 END), 0)::float AS earned_credits,
          COUNT(*)::int AS attempts,
          COALESCE(SUM(CASE WHEN NOT e.passed OR e.final_score < 5 THEN 1 ELSE 0 END), 0)::int AS failed_count,
          COALESCE(AVG(e.final_score), 0)::float AS avg_score
        FROM enrollments e
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN courses c ON c.id = co.course_id
        WHERE e.student_id = %s
        """,
        (student["id"],),
    ) or {}
    earned = float(stats.get("earned_credits") or 0)
    required = float(student.get("required_credits") or 0)
    ratio = (earned / required * 100) if required else 0

    risk_info = query_one(
        "WITH risk AS (" + RISK_SQL + ") SELECT delay_risk_score FROM risk WHERE id = %s",
        (student["id"],)
    )
    risk_score = float(risk_info["delay_risk_score"]) if risk_info else 0.0

    if risk_score >= 75:
        progress_status = f"Sinh viên hiện có nguy cơ trễ tiến độ rất cao (mức rủi ro trễ hạn: {risk_score}%)."
    elif risk_score >= 55:
        progress_status = f"Sinh viên hiện có nguy cơ trễ tiến độ cao (mức rủi ro trễ hạn: {risk_score}%)."
    elif risk_score >= 35:
        progress_status = f"Sinh viên hiện có nguy cơ trễ tiến độ trung bình (mức rủi ro trễ hạn: {risk_score}%)."
    else:
        progress_status = f"Sinh viên hiện tại không bị chậm tiến độ (mức rủi ro trễ hạn thấp: {risk_score}%)."

    rows = [
        {
            "MSSV": student["mssv"],
            "Họ tên": student["full_name"],
            "Lớp": student["class_code"],
            "GPA hiện tại": round(float(student.get("current_gpa") or 0), 2),
            "Trạng thái": student.get("academic_status") or "studying",
            "Tín chỉ đạt": earned,
            "Tín chỉ yêu cầu": required,
            "Tiến độ (%)": round(ratio, 1),
            "Số môn rớt": int(stats.get("failed_count") or 0),
            "Điểm TB lượt thi": round(float(stats.get("avg_score") or 0), 2),
            "Rủi ro trễ hạn (%)": risk_score,
        }
    ]
    answer = (
        f"{student['full_name']} ({student['mssv']}, lớp {student['class_code']}) — GPA {round(float(student.get('current_gpa') or 0), 2)}, "
        f"đã đạt {earned:.0f}/{required:.0f} tín chỉ ({ratio:.1f}%), {int(stats.get('failed_count') or 0)} môn rớt. "
        f"{progress_status}"
    )
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Ho so sinh vien va muc do tre tien do",
    }


def student_transcript_rows(
    user: CurrentUser, params: dict[str, Any], message: str
) -> dict[str, Any]:
    student = find_student_for_chat(user, params, message)
    if not student:
        return {
            "answer": "Mình chưa xác định được sinh viên để lấy bảng điểm. Bạn gửi MSSV hoặc họ tên nhé.",
            "rows": [],
            "visualization": {"type": "none"},
            "sqlPreview": "-- Khong tim thay sinh vien",
        }
    raw_rows = query(
        """
        SELECT
          t.term_code,
          c.course_code,
          c.course_name,
          c.credits::int AS credits,
          e.attempt_no::int AS attempt_no,
          COALESCE(e.overall_score, e.final_score)::float AS score,
          e.letter_grade,
          e.passed
        FROM enrollments e
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN courses c ON c.id = co.course_id
        JOIN terms t ON t.id = co.term_id
        WHERE e.student_id = %s
        ORDER BY t.start_date, c.course_code, e.attempt_no
        """,
        (student["id"],),
    )
    rows = [
        {
            "Học kỳ": row["term_code"],
            "Mã môn": row["course_code"],
            "Môn": row["course_name"],
            "TC": row["credits"],
            "Lần thi": row["attempt_no"],
            "Điểm": round(float(row["score"] or 0), 2),
            "Chữ": row["letter_grade"],
            "Đạt": "✓" if row["passed"] else "✗",
        }
        for row in raw_rows
    ]
    passed = sum(1 for r in raw_rows if r["passed"])
    answer = (
        f"Bảng điểm {student['full_name']} ({student['mssv']}): {len(rows)} lượt ghi nhận, "
        f"đạt {passed}/{len(rows)} môn."
        if rows
        else f"Chưa có dữ liệu điểm cho {student['full_name']} ({student['mssv']})."
    )
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Bang diem sinh vien",
    }


def class_summary_rows(
    class_code: str | None, allowed_codes: list[str]
) -> dict[str, Any]:
    if not class_code:
        return {
            "answer": "Bạn cho mình biết mã lớp cụ thể (ví dụ ATTN2022) để tổng hợp nhé.",
            "rows": [],
            "visualization": {"type": "none"},
            "sqlPreview": "-- Thieu ma lop",
        }
    row = query_one(
        """
        SELECT
          cl.class_code,
          cl.class_name,
          cl.required_credits::int AS required_credits,
          COUNT(s.id)::int AS total_students,
          COALESCE(AVG(s.current_gpa), 0)::float AS avg_gpa,
          COALESCE(MAX(s.current_gpa), 0)::float AS max_gpa,
          COALESCE(MIN(s.current_gpa), 0)::float AS min_gpa,
          COUNT(CASE WHEN s.current_gpa < 5 THEN 1 END)::int AS gpa_below_5,
          COUNT(CASE WHEN s.current_gpa >= 8 THEN 1 END)::int AS gpa_above_8,
          COUNT(CASE WHEN s.academic_status = 'graduated' THEN 1 END)::int AS graduated,
          COUNT(CASE WHEN s.academic_status = 'warning' THEN 1 END)::int AS warning_status
        FROM classes cl
        LEFT JOIN students s ON s.class_id = cl.id
        WHERE cl.class_code = %s AND cl.class_code = ANY(%s)
        GROUP BY cl.class_code, cl.class_name, cl.required_credits
        """,
        (class_code, allowed_codes),
    )
    if not row:
        return {
            "answer": f"Mình chưa thấy lớp {class_code} trong phạm vi truy cập.",
            "rows": [],
            "visualization": {"type": "none"},
            "sqlPreview": "-- Khong co lop",
        }
    rows = [
        {
            "Mã lớp": row["class_code"],
            "Tên lớp": row["class_name"],
            "Sĩ số": row["total_students"],
            "GPA TB": round(float(row["avg_gpa"]), 2),
            "GPA cao nhất": round(float(row["max_gpa"]), 2),
            "GPA thấp nhất": round(float(row["min_gpa"]), 2),
            "SV GPA < 5": row["gpa_below_5"],
            "SV GPA ≥ 8": row["gpa_above_8"],
            "Đã tốt nghiệp": row["graduated"],
            "Đang cảnh báo": row["warning_status"],
        }
    ]
    answer = (
        f"Lớp {row['class_code']} có {row['total_students']} SV, GPA TB {float(row['avg_gpa']):.2f}, "
        f"{row['gpa_below_5']} SV dưới 5, {row['gpa_above_8']} SV từ 8 trở lên."
    )
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Tong quan lop",
    }


def course_failures_rows(
    course_code: str | None,
    course_name: str | None,
    class_code: str | None,
    allowed_codes: list[str],
) -> dict[str, Any]:
    if not course_code and not course_name:
        return {
            "answer": "Bạn cho mình biết môn cụ thể (mã môn hoặc tên) để liệt kê sinh viên rớt nhé.",
            "rows": [],
            "visualization": {"type": "none"},
            "sqlPreview": "-- Thieu mon",
        }
    sql = """
    SELECT
      s.mssv,
      s.full_name,
      cl.class_code,
      c.course_code,
      c.course_name,
      t.term_code,
      e.attempt_no::int AS attempt_no,
      COALESCE(e.overall_score, e.final_score)::float AS score,
      e.letter_grade
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN classes cl ON cl.id = s.class_id
    JOIN course_offerings co ON co.id = e.course_offering_id
    JOIN courses c ON c.id = co.course_id
    JOIN terms t ON t.id = co.term_id
    WHERE cl.class_code = ANY(%s)
      AND (NOT e.passed OR e.final_score < 5)
    """
    params: list[Any] = [allowed_codes]
    if class_code:
        sql += " AND cl.class_code = %s"
        params.append(class_code)
    if course_code:
        sql += " AND c.course_code = %s"
        params.append(course_code)
    elif course_name:
        sql += " AND LOWER(c.course_name) = LOWER(%s)"
        params.append(course_name)
    sql += " ORDER BY score ASC, s.full_name LIMIT 100"
    raw_rows = query(sql, tuple(params))
    rows = [
        {
            "MSSV": r["mssv"],
            "Họ tên": r["full_name"],
            "Lớp": r["class_code"],
            "Mã môn": r["course_code"],
            "Môn": r["course_name"],
            "Học kỳ": r["term_code"],
            "Lần thi": r["attempt_no"],
            "Điểm": round(float(r["score"] or 0), 2),
            "Chữ": r["letter_grade"],
        }
        for r in raw_rows
    ]
    subject = rows[0]["Môn"] if rows else (course_name or course_code)
    scope = f" lớp {class_code}" if class_code else ""
    answer = (
        f"Có {len(rows)} lượt rớt môn {subject}{scope}." if rows
        else f"Không có sinh viên nào rớt môn {subject}{scope}."
    )
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Sinh vien rot mon",
    }


def near_graduation_rows(
    user: CurrentUser, class_code: str | None, limit: int
) -> dict[str, Any]:
    students = fetch_risk_students(user, class_code)
    candidates = [
        s for s in students
        if s.get("academicStatus") != "graduated"
        and s.get("completionRatio", 0) >= 80
    ]
    candidates.sort(key=lambda s: (-s["completionRatio"], -s["currentGpa"]))
    rows = [
        {
            "MSSV": s["mssv"],
            "Họ tên": s["fullName"],
            "Lớp": s["classCode"],
            "GPA": s["currentGpa"],
            "Tín chỉ đạt": s["completedCredits"],
            "Yêu cầu": s["requiredCredits"],
            "Tiến độ (%)": s["completionRatio"],
            "Tín chỉ nợ": s["debtCredits"],
        }
        for s in candidates[: max(1, min(limit, 50))]
    ]
    scope = f" lớp {class_code}" if class_code else ""
    answer = (
        f"Có {len(candidates)} sinh viên sắp tốt nghiệp{scope} (hoàn thành ≥80% tín chỉ)." if candidates
        else f"Chưa có sinh viên nào đạt mốc 80% tín chỉ{scope}."
    )
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Sinh vien sap tot nghiep",
    }


def most_failed_courses_rows(
    class_code: str | None, allowed_codes: list[str], limit: int
) -> dict[str, Any]:
    sql = """
    SELECT
      c.course_code,
      c.course_name,
      COUNT(*)::int AS total_attempts,
      COUNT(CASE WHEN NOT e.passed OR e.final_score < 5 THEN 1 END)::int AS failed,
      ROUND(
        COUNT(CASE WHEN NOT e.passed OR e.final_score < 5 THEN 1 END)::numeric
        / NULLIF(COUNT(*), 0) * 100, 1
      )::float AS fail_rate
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN classes cl ON cl.id = s.class_id
    JOIN course_offerings co ON co.id = e.course_offering_id
    JOIN courses c ON c.id = co.course_id
    WHERE cl.class_code = ANY(%s)
    """
    params: list[Any] = [allowed_codes]
    if class_code:
        sql += " AND cl.class_code = %s"
        params.append(class_code)
    sql += """
    GROUP BY c.course_code, c.course_name
    HAVING COUNT(CASE WHEN NOT e.passed OR e.final_score < 5 THEN 1 END) > 0
    ORDER BY fail_rate DESC, failed DESC
    LIMIT %s
    """
    params.append(max(1, min(limit, 30)))
    raw_rows = query(sql, tuple(params))
    rows = [
        {
            "Mã môn": r["course_code"],
            "Môn": r["course_name"],
            "Tổng lượt thi": r["total_attempts"],
            "Số lượt rớt": r["failed"],
            "Tỉ lệ rớt (%)": r["fail_rate"],
        }
        for r in raw_rows
    ]
    scope = f" lớp {class_code}" if class_code else ""
    if rows:
        top = rows[0]
        answer = (
            f"Môn có tỉ lệ rớt cao nhất{scope}: {top['Môn']} ({top['Tỉ lệ rớt (%)']}%, "
            f"{top['Số lượt rớt']}/{top['Tổng lượt thi']} lượt)."
        )
    else:
        answer = f"Chưa thấy môn nào có sinh viên rớt{scope}."
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "table"},
        "sqlPreview": "-- Mon co ti le rot cao",
    }


def execute_chat_plan(
    plan: dict[str, Any], user: CurrentUser, message: str = ""
) -> dict[str, Any]:
    params = plan.get("params", {}) if isinstance(plan.get("params"), dict) else {}
    class_code = (
        params.get("classCode")
        or params.get("class_code")
        or params.get("class")
        or params.get("lop")
        or params.get("lớp")
    )
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    if class_code and class_code not in allowed_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Forbidden class scope: {class_code}",
        )

    if plan["tool"] == "student_comment":
        return student_comment_result(user, params, message)

    if plan["tool"] == "student_profile":
        return student_profile_rows(user, params, message)

    if plan["tool"] == "student_transcript":
        return student_transcript_rows(user, params, message)

    if plan["tool"] == "class_summary":
        return class_summary_rows(class_code, allowed_codes)

    if plan["tool"] == "course_failures":
        return course_failures_rows(
            params.get("courseCode"),
            params.get("courseName"),
            class_code,
            allowed_codes,
        )

    if plan["tool"] == "near_graduation":
        return near_graduation_rows(user, class_code, int(params.get("limit") or 10))

    if plan["tool"] == "most_failed_courses":
        return most_failed_courses_rows(class_code, allowed_codes, int(params.get("limit") or 5))

    if plan["tool"] == "top_course_scores":
        return top_course_scores_rows(
            params.get("courseCode"),
            params.get("courseName"),
            class_code,
            allowed_codes,
            int(params.get("limit") or 5),
        )

    if plan["tool"] == "top_students":
        limit = int(params.get("limit") or 5)
        sql = """
        SELECT s.mssv, s.full_name, cl.class_code, ROUND(s.current_gpa::numeric, 2) AS current_gpa
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        WHERE cl.class_code = ANY(%s)
        """
        query_params: list[Any] = [allowed_codes]
        if class_code:
            sql += " AND cl.class_code = %s"
            query_params.append(class_code)
        sql += " ORDER BY s.current_gpa DESC, s.mssv LIMIT %s"
        query_params.append(limit)
        raw_rows = query(sql, tuple(query_params))
        rows = [
            {
                "MSSV": row["mssv"],
                "Họ tên": row["full_name"],
                "Lớp": row["class_code"],
                "GPA hiện tại": float(row["current_gpa"] or 0),
            }
            for row in raw_rows
        ]
        
        # Generate natural response
        if rows:
            top_student = rows[0]
            answer_parts = [
                f"Sinh viên xuất sắc nhất là {top_student['Họ tên']} ({top_student['MSSV']}) "
                f"với GPA {top_student['GPA hiện tại']}."
            ]
            if len(rows) > 1:
                gpa_list = ", ".join([f"{r['Họ tên']} (GPA: {r['GPA hiện tại']})" for r in rows[1:3]])
                answer_parts.append(f"Những sinh viên khác cũng có thành tích tốt: {gpa_list}.")
            answer = " ".join(answer_parts)
        else:
            answer = "Mình chưa tìm thấy sinh viên phù hợp với câu hỏi này."
        
        return {
            "answer": answer,
            "rows": rows,
            "visualization": {"type": "table"},
            "sqlPreview": "-- Top sinh viên theo GPA hiện tại",
        }

    if plan["tool"] == "low_gpa_students":
        limit = int(params.get("limit") or 5)
        sql = """
        SELECT s.mssv, s.full_name, cl.class_code, ROUND(s.current_gpa::numeric, 2) AS current_gpa
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        WHERE cl.class_code = ANY(%s)
        """
        query_params: list[Any] = [allowed_codes]
        if class_code:
            sql += " AND cl.class_code = %s"
            query_params.append(class_code)
        sql += " ORDER BY s.current_gpa ASC, s.mssv LIMIT %s"
        query_params.append(limit)
        raw_rows = query(sql, tuple(query_params))
        rows = [
            {
                "MSSV": row["mssv"],
                "Họ tên": row["full_name"],
                "Lớp": row["class_code"],
                "GPA hiện tại": float(row["current_gpa"] or 0),
            }
            for row in raw_rows
        ]
        
        # Generate natural response
        if rows:
            low_student = rows[0]
            answer_parts = [
                f"Sinh viên có GPA thấp nhất là {low_student['Họ tên']} ({low_student['MSSV']}) "
                f"với GPA {low_student['GPA hiện tại']}. Cần hỗ trợ sinh viên này."
            ]
            if len(rows) > 1:
                gpa_list = ", ".join([f"{r['Họ tên']} (GPA: {r['GPA hiện tại']})" for r in rows[1:3]])
                answer_parts.append(f"Những sinh viên khác cần chú ý: {gpa_list}.")
            answer = " ".join(answer_parts)
        else:
            answer = "Mình chưa tìm thấy sinh viên phù hợp với câu hỏi này."
        
        return {
            "answer": answer,
            "rows": rows,
            "visualization": {"type": "table"},
            "sqlPreview": "-- Sinh viên GPA thấp nhất",
        }

    if plan["tool"] == "at_risk_students":
        course_code = params.get("courseCode")
        course_name = params.get("courseName")
        students = fetch_risk_students(user, class_code)
        filtered = [
            item
            for item in students
            if item["failedCourses"] > 0 or item["lowScoreCourses"] > 0
        ]
        if course_code or course_name:
            course_rows = query(
                """
                SELECT DISTINCT s.mssv
                FROM enrollments e
                JOIN students s ON s.id = e.student_id
                JOIN course_offerings co ON co.id = e.course_offering_id
                JOIN courses c ON c.id = co.course_id
                JOIN classes cl ON cl.id = s.class_id
                WHERE cl.class_code = ANY(%s)
                  AND e.final_score < 5
                  AND (%s IS NULL OR c.course_code = %s)
                  AND (%s IS NULL OR LOWER(c.course_name) = LOWER(%s))
                """,
                (allowed_codes, course_code, course_code, course_name, course_name),
            )
            mssv_set = {row["mssv"] for row in course_rows}
            filtered = [item for item in filtered if item["mssv"] in mssv_set]
        compact_rows = [compact_risk_row(item) for item in filtered]
        
        # Generate natural response
        if filtered:
            critical_note = f" (trong đó {len([s for s in filtered if s['riskBand'] == 'critical'])} trường hợp nguy cấp)" if any(s['riskBand'] == 'critical' for s in filtered) else ""
            answer = f"Có {len(filtered)} sinh viên cần chú ý về nguy cơ rớt môn{critical_note}. Mình đã liệt kê danh sách để bạn hỗ trợ kịp thời."
        else:
            answer = "Tốt lắm! Hiện chưa có sinh viên nào nổi bật về nguy cơ rớt môn theo điều kiện bạn hỏi."
        
        return {
            "answer": answer,
            "rows": compact_rows,
            "visualization": {"type": "table"},
            "sqlPreview": "-- Nhóm sinh viên nguy cơ rớt môn",
        }

    if plan["tool"] == "grade_distribution":
        return grade_distribution_rows(
            params.get("courseCode"),
            params.get("courseName"),
            class_code,
            allowed_codes,
        )

    students = fetch_risk_students(user, class_code)
    top = students[:5]
    critical = len([item for item in students if item["riskBand"] == "critical"])
    return {
        "answer": (
            f"Mình đang thấy {len(students)} sinh viên, trong đó {critical} trường hợp ở mức nguy cấp. "
            f"Cần ưu tiên {top[0]['fullName']} ({top[0]['mssv']}) với điểm rủi ro {top[0]['delayRiskScore']}%."
            if top
            else "Mình chưa có dữ liệu rủi ro phù hợp để tổng hợp."
        ),
        "rows": [compact_risk_row(item) for item in top],
        "visualization": {"type": "table"},
        "sqlPreview": "-- Tổng quan rủi ro học vụ",
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "api-python",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


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
    write_audit_log(
        None, "login", "user", str(user["id"]), {"username": payload.username}
    )
    return {"accessToken": token}


@app.get("/classes")
def classes(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    return get_accessible_classes(user)


@app.get("/classes/{class_id}/students")
def class_students(
    class_id: str, user: CurrentUser = Depends(require_auth)
) -> list[dict[str, Any]]:
    if not can_access_class(user, class_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden class scope"
        )
    return query(
        """
        SELECT id, mssv, full_name, COALESCE(current_gpa, 0)::float AS current_gpa, academic_status
        FROM students
        WHERE class_id = %s
        ORDER BY full_name, mssv
        """,
        (class_id,),
    )


def student_profile_data(mssv: str) -> dict[str, Any] | None:
    return query_one(
        """
        SELECT
          s.id,
          s.mssv,
          s.full_name,
          s.current_gpa::float AS current_gpa,
          s.english_level,
          s.cohort_year,
          s.program_code,
          s.training_system,
          s.academic_status,
          c.class_code,
          c.class_name,
          c.required_credits
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.mssv = %s
        """,
        (mssv,),
    )


def gpa_trend_data(mssv: str) -> list[dict[str, Any]]:
    return query(
        """
        SELECT t.term_code AS "termCode", ROUND(AVG(e.final_score)::numeric, 2)::float AS gpa
        FROM enrollments e
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN terms t ON t.id = co.term_id
        JOIN students s ON s.id = e.student_id
        WHERE s.mssv = %s
        GROUP BY t.term_code
        ORDER BY t.term_code
        """,
        (mssv,),
    )


def student_grades_data(mssv: str) -> dict[str, Any] | None:
    student = student_profile_data(mssv)
    if not student:
        return None

    rows = query(
        """
        SELECT
          t.term_code AS "termCode",
          t.term_name AS "termName",
          t.start_date::text AS "startDate",
          c.course_code AS "courseCode",
          c.course_name AS "courseName",
          c.credits::int AS credits,
          e.attempt_no::int AS "attemptNo",
          COALESCE(e.process_score, 0)::float AS "processScore",
          COALESCE(e.midterm_score, 0)::float AS "midtermScore",
          COALESCE(e.practical_score, 0)::float AS "practicalScore",
          e.final_score::float AS "finalScore",
          COALESCE(e.overall_score, e.final_score)::float AS "overallScore",
          e.letter_grade AS "letterGrade",
          e.passed AS passed,
          e.is_retake AS "isRetake",
          e.synced_at::text AS "syncedAt",
          e.source_system AS "sourceSystem"
        FROM enrollments e
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN courses c ON c.id = co.course_id
        JOIN terms t ON t.id = co.term_id
        JOIN students s ON s.id = e.student_id
        WHERE s.mssv = %s
        ORDER BY t.start_date, c.course_code, e.attempt_no
        """,
        (mssv,),
    )

    terms: dict[str, dict[str, Any]] = {}
    for row in rows:
        term = terms.setdefault(
            row["termCode"],
            {
                "termCode": row["termCode"],
                "termName": row["termName"],
                "startDate": row["startDate"],
                "registeredCredits": 0,
                "passedCredits": 0,
                "termGpa": 0,
                "courses": [],
            },
        )
        term["registeredCredits"] += int(row["credits"])
        if row["passed"]:
            term["passedCredits"] += int(row["credits"])
        term["courses"].append(
            {
                "courseCode": row["courseCode"],
                "courseName": row["courseName"],
                "credits": int(row["credits"]),
                "attemptNo": int(row["attemptNo"]),
                "processScore": float(row["processScore"] or 0),
                "midtermScore": float(row["midtermScore"] or 0),
                "practicalScore": float(row["practicalScore"] or 0),
                "finalScore": float(row["finalScore"] or 0),
                "overallScore": float(row["overallScore"] or 0),
                "letterGrade": row["letterGrade"],
                "passed": bool(row["passed"]),
                "isRetake": bool(row["isRetake"]),
                "syncedAt": row["syncedAt"],
                "sourceSystem": row["sourceSystem"],
            }
        )

    for term in terms.values():
        scored_courses = [
            course
            for course in term["courses"]
            if str(course["letterGrade"]).upper() not in {"MIEN", "MIỄN", "EXEMPT"}
        ]
        if scored_courses:
            term["termGpa"] = round(
                sum(float(course["finalScore"]) for course in scored_courses)
                / len(scored_courses),
                2,
            )

    all_courses = [course for term in terms.values() for course in term["courses"]]
    return {
        "student": {
            "id": student["id"],
            "mssv": student["mssv"],
            "fullName": student["full_name"],
            "classCode": student["class_code"],
        },
        "summary": {
            "courseCount": len(all_courses),
            "registeredCredits": sum(int(course["credits"]) for course in all_courses),
            "passedCredits": sum(
                int(course["credits"]) for course in all_courses if course["passed"]
            ),
            "failedCount": len([course for course in all_courses if not course["passed"]]),
        },
        "terms": list(terms.values()),
    }


def parse_mssv_selection(value: str | None) -> list[str]:
    if not value:
        return []
    cleaned = [item.strip() for item in value.split(",") if item.strip()]
    return list(dict.fromkeys(cleaned))


def gpa_lines_data(
    user: CurrentUser,
    class_code: str | None = None,
    selected_mssv: str | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    if class_code and class_code not in allowed_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden class scope"
        )

    scoped_codes = [class_code] if class_code else allowed_codes
    selected = parse_mssv_selection(selected_mssv)
    safe_limit = max(1, min(limit, 30))

    available_students = query(
        """
        SELECT
          s.mssv,
          s.full_name AS "fullName",
          c.class_code AS "classCode",
          COALESCE(s.current_gpa, 0)::float AS "currentGpa"
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE c.class_code = ANY(%s)
        ORDER BY s.current_gpa DESC, s.full_name, s.mssv
        """,
        (scoped_codes,),
    )

    if selected:
        student_rows = query(
            """
            SELECT
              s.mssv,
              s.full_name AS "fullName",
              c.class_code AS "classCode",
              COALESCE(s.current_gpa, 0)::float AS "currentGpa"
            FROM students s
            JOIN classes c ON c.id = s.class_id
            WHERE c.class_code = ANY(%s)
              AND s.mssv = ANY(%s)
            ORDER BY array_position(%s::text[], s.mssv), s.mssv
            """,
            (scoped_codes, selected, selected),
        )
    else:
        student_rows = query(
            """
            SELECT
              s.mssv,
              s.full_name AS "fullName",
              c.class_code AS "classCode",
              COALESCE(s.current_gpa, 0)::float AS "currentGpa"
            FROM students s
            JOIN classes c ON c.id = s.class_id
            WHERE c.class_code = ANY(%s)
            ORDER BY RANDOM()
            LIMIT %s
            """,
            (scoped_codes, safe_limit),
        )

    selected_ids = [row["mssv"] for row in student_rows]
    if not selected_ids:
        return {
            "termCodes": [],
            "students": [],
            "availableStudents": available_students,
        }

    trend_rows = query(
        """
        SELECT
          s.mssv,
          t.term_code AS "termCode",
          ROUND(AVG(e.final_score)::numeric, 2)::float AS gpa
        FROM enrollments e
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN terms t ON t.id = co.term_id
        JOIN students s ON s.id = e.student_id
        WHERE s.mssv = ANY(%s)
        GROUP BY s.mssv, t.term_code
        ORDER BY s.mssv, t.term_code
        """,
        (selected_ids,),
    )

    term_codes = sorted({row["termCode"] for row in trend_rows}, key=term_order)
    trends_by_student: dict[str, dict[str, float]] = {}
    for row in trend_rows:
        trends_by_student.setdefault(row["mssv"], {})[row["termCode"]] = float(
            row["gpa"] or 0
        )

    return {
        "termCodes": term_codes,
        "students": [
            {
                "mssv": row["mssv"],
                "fullName": row["fullName"],
                "classCode": row["classCode"],
                "currentGpa": float(row["currentGpa"] or 0),
                "series": [
                    {
                        "termCode": term_code,
                        "gpa": trends_by_student.get(row["mssv"], {}).get(term_code),
                    }
                    for term_code in term_codes
                ],
            }
            for row in student_rows
        ],
        "availableStudents": available_students,
    }


def credit_progress_data(mssv: str) -> dict[str, float]:
    row = query_one(
        """
        WITH target_student AS (
          SELECT s.id, cl.required_credits
          FROM students s
          JOIN classes cl ON cl.id = s.class_id
          WHERE s.mssv = %s
        ),
        course_state AS (
          SELECT
            c.course_code,
            c.credits,
            BOOL_OR(e.passed) AS has_passed,
            BOOL_OR(e.passed = false OR e.final_score < 5) AS has_failed
          FROM target_student ts
          JOIN enrollments e ON e.student_id = ts.id
          JOIN course_offerings co ON co.id = e.course_offering_id
          JOIN courses c ON c.id = co.course_id
          GROUP BY c.course_code, c.credits
        )
        SELECT
          COALESCE(SUM(CASE WHEN cs.has_passed THEN cs.credits ELSE 0 END), 0)::float AS completed,
          MAX(ts.required_credits)::float AS required,
          COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN cs.credits ELSE 0 END), 0)::float AS debt
        FROM target_student ts
        LEFT JOIN course_state cs ON true
        GROUP BY ts.id
        """,
        (mssv,),
    )
    return {
        "completed": float((row or {}).get("completed") or 0),
        "required": float((row or {}).get("required") or 0),
        "debt": float((row or {}).get("debt") or 0),
    }


def risk_profile_data(user: CurrentUser, mssv: str) -> dict[str, Any] | None:
    return next((item for item in fetch_risk_students(user) if item["mssv"] == mssv), None)


def notes_data(mssv: str, limit: int | None = None) -> list[dict[str, Any]]:
    sql = """
        SELECT n.note, n.created_at
        FROM advisory_notes n
        JOIN students s ON s.id = n.student_id
        WHERE s.mssv = %s
        ORDER BY n.created_at DESC
    """
    params: list[Any] = [mssv]
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)
    return query(sql, tuple(params))


def alerts_data(student_id: str, limit: int | None = None) -> list[dict[str, Any]]:
    sql = """
        SELECT id, alert_type, severity, message, created_at
        FROM alerts
        WHERE student_id = %s
        ORDER BY created_at DESC
    """
    params: list[Any] = [student_id]
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)
    alerts = query(sql, tuple(params))
    student = query_one("SELECT mssv FROM students WHERE id = %s", (student_id,))
    if not student:
        return alerts

    report = build_academic_progress_report(student["mssv"])
    delayed_terms = [
        term for term in (report or {}).get("termProgress", []) if term["status"] == "delayed"
    ]
    if delayed_terms:
        latest_delayed = delayed_terms[-1]
        alerts.insert(
            0,
            {
                "id": f"policy-delay-{student['mssv']}",
                "alert_type": "academic_progress",
                "severity": "high",
                "message": f"Chậm tiến độ ở {latest_delayed['termCode']}: {latest_delayed['reason']}",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    return alerts[:limit] if limit is not None else alerts


def build_academic_progress_report(mssv: str) -> dict[str, Any] | None:
    student = student_profile_data(mssv)
    if not student:
        return None

    identification = identify_program(student["class_code"])
    program = identification["program"]
    curriculum = curriculum_courses(program)
    curriculum_by_code = {item["code"].upper(): item for item in curriculum}

    enrollments = query(
        """
        SELECT
          t.term_code,
          t.term_name,
          t.start_date::text AS start_date,
          c.course_code,
          c.course_name,
          c.credits,
          e.attempt_no,
          e.is_retake,
          e.final_score::float AS final_score,
          e.letter_grade
        FROM enrollments e
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN courses c ON c.id = co.course_id
        JOIN terms t ON t.id = co.term_id
        JOIN students s ON s.id = e.student_id
        WHERE s.mssv = %s
        ORDER BY t.start_date, c.course_code
        """,
        (mssv,),
    )

    buckets: dict[str, dict[str, Any]] = {}
    for row in enrollments:
        bucket = buckets.setdefault(
            row["term_code"],
            {
                "termName": row["term_name"],
                "startDate": row["start_date"],
                "rows": [],
            },
        )
        bucket["rows"].append(row)

    sorted_terms = sorted(
        buckets.items(),
        key=lambda item: (term_order(item[0]), item[1]["startDate"]),
    )

    term_index_by_code = {term_code: term_order(term_code) for term_code, _ in sorted_terms}
    completed_term_codes = {term_code for term_code, _ in sorted_terms[:-1]}
    attempts: dict[str, list[dict[str, Any]]] = {}
    for row in enrollments:
        if row["term_code"] not in completed_term_codes:
            continue
        attempts.setdefault(row["course_code"].upper(), []).append(row)

    failed_courses = []
    for course_code, rows in attempts.items():
        failed_rows = [row for row in rows if failed_by_policy(row)]
        if failed_rows:
            failed_row = min(
                failed_rows,
                key=lambda row: (
                    term_index_by_code.get(row["term_code"], 999),
                    int(row.get("attempt_no") or 1),
                ),
            )
            failed_order = (
                term_index_by_code.get(failed_row["term_code"], 999),
                int(failed_row.get("attempt_no") or 1),
            )
            retake_rows = [
                row
                for row in rows
                if (
                    term_index_by_code.get(row["term_code"], 999),
                    int(row.get("attempt_no") or 1),
                )
                > failed_order
            ]
            passed_retake = next(
                (row for row in retake_rows if passed_by_policy(row)),
                None,
            )
            failed_courses.append(
                {
                    "termCode": failed_row["term_code"],
                    "courseCode": course_code,
                    "courseName": failed_row["course_name"],
                    "credits": int(failed_row["credits"]),
                    "finalScore": float(failed_row["final_score"]),
                    "letterGrade": failed_row["letter_grade"],
                    "retaken": bool(retake_rows),
                    "resolved": passed_retake is not None,
                    "retakeTermCode": passed_retake["term_code"] if passed_retake else None,
                    "retakeScore": float(passed_retake["final_score"]) if passed_retake else None,
                }
            )

    cumulative = 0
    passed_graduation_work = False
    term_progress: list[dict[str, Any]] = []
    total_required_credits = 129 if program == "ATTT" else 130 if program == "MMTTTDL" else None
    for term_code, bucket in sorted_terms:
        index = term_order(term_code)
        registered = sum(int(row["credits"]) for row in bucket["rows"])
        passed = sum(int(row["credits"]) for row in bucket["rows"] if passed_by_policy(row))
        cumulative += passed
        current_passed_graduation_work = any(
            row["course_code"].upper() in GRADUATION_WORK_CODES and passed_by_policy(row)
            for row in bucket["rows"]
        )
        passed_graduation_work = passed_graduation_work or current_passed_graduation_work
        expected_cumulative = index * 17
        if total_required_credits is not None:
            expected_cumulative = min(expected_cumulative, total_required_credits)
        graduation_work_deferred = (
            total_required_credits is not None
            and cumulative >= total_required_credits - 10
            and not passed_graduation_work
        )
        delayed_by_cumulative = cumulative < expected_cumulative and not graduation_work_deferred
        valid = not delayed_by_cumulative
        if delayed_by_cumulative:
            term_status = "delayed"
            reason = f"Lũy kế đạt {cumulative} TC, thấp hơn mốc {expected_cumulative} TC của HK{index}."
        elif graduation_work_deferred:
            term_status = "normal"
            reason = "Đã hoàn tất các học phần còn thiếu, chỉ còn khóa luận tốt nghiệp ở kỳ sau."
        else:
            term_status = "normal"
            reason = f"Lũy kế đạt {cumulative} TC, đạt mốc {expected_cumulative} TC của HK{index}."

        term_progress.append(
            {
                "termIndex": index,
                "termCode": term_code,
                "termName": bucket["termName"],
                "registeredCredits": registered,
                "passedCredits": passed,
                "cumulativePassedCredits": cumulative,
                "validRegistration": valid,
                "status": term_status,
                "reason": reason,
            }
        )

    taken_codes = {row["course_code"].upper() for row in enrollments}
    latest_actual_term_index = term_order(sorted_terms[-1][0]) if sorted_terms else 0
    missing_cutoff = max(0, latest_actual_term_index - 1)
    missing_courses = [
        item
        for item in curriculum
        if item["term"] <= missing_cutoff and item["code"].upper() not in taken_codes
    ]
    missing_courses.sort(key=lambda item: (item["term"], item["code"]))

    current_term = sorted_terms[-1] if sorted_terms else None
    current_credits = (
        sum(int(row["credits"]) for row in current_term[1]["rows"]) if current_term else 0
    )
    current_has_graduation_work = (
        any(is_graduation_work(row) for row in current_term[1]["rows"])
        if current_term
        else False
    )
    current_term_index = term_index_by_code.get(current_term[0], 0) if current_term else 0
    current_standard_credits = sum(
        int(item["credits"]) for item in curriculum if item["term"] == current_term_index
    )
    current_is_graduation_wrapup = (
        total_required_credits is not None
        and cumulative >= total_required_credits - 10
    )
    current_credit_floor_applies = not current_has_graduation_work and not current_is_graduation_wrapup and (
        not curriculum or current_standard_credits >= MIN_MAIN_TERM_CREDITS
    )
    additional_needed = (
        max(0, MIN_MAIN_TERM_CREDITS - current_credits)
        if current_credit_floor_applies
        else 0
    )

    unresolved_failed_codes = {
        item["courseCode"] for item in failed_courses if not item["resolved"]
    }
    suggested = [
        curriculum_by_code[code]
        for code in unresolved_failed_codes
        if code in curriculum_by_code
    ]
    catchup_or_current = [
        item
        for item in curriculum
        if item["code"].upper() not in taken_codes
        and item["group"] in {"Cơ sở ngành", "Chuyên ngành"}
        and item["term"] <= max(current_term_index + 1, 1)
    ]
    next_courses = [
        item
        for item in curriculum
        if item["code"].upper() not in taken_codes
        and item["group"] in {"Cơ sở ngành", "Chuyên ngành"}
        and item["term"] > current_term_index + 1
    ]
    suggested_codes: set[str] = set()
    suggested_courses = []
    for item in [*suggested, *catchup_or_current, *next_courses]:
        if item["code"] in suggested_codes:
            continue
        suggested_codes.add(item["code"])
        suggested_courses.append(item)
        if len(suggested_courses) >= 8:
            break

    return {
        "student": {
            "id": student["id"],
            "mssv": student["mssv"],
            "fullName": student["full_name"],
            "classCode": student["class_code"],
        },
        "identification": identification,
        "baseline": {
            "totalCredits": total_required_credits,
            "timelineAvailable": bool(curriculum),
            "note": "Baseline được tính theo danh mục môn UIT đã seed cho ATTT và MMT&TTDL.",
        },
        "termProgress": term_progress,
        "failedCourses": failed_courses,
        "missingCourses": {
            "status": "computed" if curriculum else "unknown_program",
            "note": (
                "Các môn trong baseline từ những học kỳ đã hoàn tất chưa thấy trong bảng điểm."
                if missing_courses
                else "Không có môn nào trong baseline của các học kỳ đã hoàn tất bị bỏ qua."
            )
            if curriculum
            else "Không thể tính môn chưa học vì chưa xác định được ngành theo policy mã lớp.",
            "items": missing_courses,
        },
        "currentRegistration": {
            "termCode": current_term[0] if current_term else None,
            "currentCredits": current_credits,
            "minimumCredits": MIN_MAIN_TERM_CREDITS,
            "additionalCreditsNeeded": additional_needed,
            "recommendationNote": (
                f"Cần đăng ký thêm tối thiểu {additional_needed} tín chỉ để đạt ngưỡng {MIN_MAIN_TERM_CREDITS} tín chỉ."
                if additional_needed > 0
                else (
                    "Kỳ hiện tại có khóa luận/chuyên đề hoặc định mức chuẩn dưới 14 tín chỉ nên không yêu cầu đăng ký thêm để đủ sàn."
                    if not current_credit_floor_applies
                    else "Khối lượng tín chỉ hiện tại đã đạt ngưỡng tối thiểu."
                )
            ),
            "suggestedCourses": suggested_courses,
        },
    }


@app.get("/students/{mssv}/profile")
def student_profile(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    student = student_profile_data(mssv)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    return student


@app.get("/students/{mssv}/gpa-trend")
def student_gpa_trend(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> list[dict[str, Any]]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    return gpa_trend_data(mssv)


@app.get("/students/{mssv}/grades")
def student_grades(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    grades = student_grades_data(mssv)
    if not grades:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    return grades


@app.get("/students/{mssv}/credit-progress")
def student_credit_progress(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, float]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    return credit_progress_data(mssv)


@app.get("/students/{mssv}/risk-profile")
def student_risk_profile(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any] | None:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    return risk_profile_data(user, mssv)


@app.get("/students/{mssv}/notes")
def student_notes(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> list[dict[str, Any]]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    return notes_data(mssv)


@app.get("/students/{mssv}/academic-progress")
def student_academic_progress(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    report = build_academic_progress_report(mssv)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    write_audit_log(user, "view_academic_progress", "student", mssv)
    return report


@app.get("/students/{mssv}/dashboard")
def student_dashboard(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    student = student_profile_data(mssv)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    gpa_trend = gpa_trend_data(mssv)
    credit_progress = credit_progress_data(mssv)
    alerts = alerts_data(student["id"], limit=8)
    notes = notes_data(mssv, limit=10)
    risk_profile = risk_profile_data(user, mssv)
    return {
        "student": {
            "id": student["id"],
            "mssv": student["mssv"],
            "full_name": student["full_name"],
            "class_code": student["class_code"],
            "academic_status": student["academic_status"],
        },
        "gpaTrend": gpa_trend,
        "creditProgress": credit_progress,
        "alerts": alerts,
        "notes": notes,
        "riskProfile": risk_profile,
    }


@app.get("/students/{mssv}/alerts")
def student_alerts(
    mssv: str, user: CurrentUser = Depends(require_auth)
) -> list[dict[str, Any]]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    student = student_profile_data(mssv)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    return alerts_data(student["id"])


@app.post("/students/{mssv}/notes")
def add_note(
    mssv: str, payload: NotePayload, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope"
        )
    note_text = payload.note.strip()
    if not note_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Note must not be empty"
        )
    student = query_one("SELECT id FROM students WHERE mssv = %s", (mssv,))
    execute(
        """
        INSERT INTO advisory_notes (student_id, advisor_user_id, note)
        VALUES (%s, %s, %s)
        """,
        (student["id"], user.user_id, note_text),
    )
    write_audit_log(
        user, "create_note", "student", mssv, {"note_length": len(note_text)}
    )
    return {"message": "Note saved"}


@app.get("/analytics/grade-distributions")
def analytics_grade_distribution(
    courseOfferingId: str, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    offering = query_one(
        """
        SELECT co.id, cl.class_code, c.course_name, c.course_code
        FROM course_offerings co
        JOIN classes cl ON cl.id = co.class_id
        JOIN courses c ON c.id = co.course_id
        WHERE co.id = %s
        """,
        (courseOfferingId,),
    )
    if not offering:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course offering not found"
        )
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    if offering["class_code"] not in allowed_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden class scope"
        )
    return grade_distribution_rows(
        offering["course_code"],
        offering["course_name"],
        offering["class_code"],
        allowed_codes,
    )


@app.get("/analytics/graduation-forecast")
def graduation_forecast(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    students = fetch_risk_students(user)
    on_track = len(
        [
            item
            for item in students
            if item["completionRatio"] >= 75 and item["currentGpa"] >= 5
        ]
    )
    watchlist = len(
        [item for item in students if item["riskBand"] in {"medium", "high"}]
    )
    critical = len([item for item in students if item["riskBand"] == "critical"])
    return {"onTrack": on_track, "watchlist": watchlist, "critical": critical}


@app.get("/analytics/class-leaderboard")
def class_leaderboard(
    user: CurrentUser = Depends(require_auth),
) -> list[dict[str, Any]]:
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    return query(
        """
        SELECT
          cl.class_code,
          ROUND(AVG(s.current_gpa)::numeric, 2) AS average_gpa,
          COUNT(*)::int AS student_count
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        WHERE cl.class_code = ANY(%s)
        GROUP BY cl.class_code
        ORDER BY AVG(s.current_gpa) DESC, cl.class_code
        """,
        (allowed_codes,),
    )


@app.get("/ai/overview")
def ai_overview(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    students = fetch_risk_students(user)
    alerts_count = query_one(
        """
        SELECT COUNT(*)::int AS total
        FROM alerts a
        JOIN students s ON s.id = a.student_id
        JOIN classes c ON c.id = s.class_id
        WHERE c.class_code = ANY(%s)
        """,
        ([row["class_code"] for row in get_accessible_classes(user)],),
    )["total"]
    return {
        "kpis": {
            "students": len(students),
            "highRisk": len(
                [item for item in students if item["delayRiskScore"] >= 55]
            ),
            "critical": len(
                [item for item in students if item["delayRiskScore"] >= 75]
            ),
            "alerts": alerts_count,
            "averageRisk": (
                round(
                    sum(item["delayRiskScore"] for item in students) / len(students), 1
                )
                if students
                else 0
            ),
        },
        "topRisks": students[:6],
    }


@app.get("/ai/predictive/students")
def predictive_students(
    classCode: str | None = None, user: CurrentUser = Depends(require_auth)
) -> list[dict[str, Any]]:
    return fetch_risk_students(user, classCode)


@app.get("/ai/predictive/matrix")
def predictive_matrix(
    classCode: str | None = None, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    students = fetch_risk_students(user, classCode)
    return {
        "points": [
            {
                "mssv": item["mssv"],
                "fullName": item["fullName"],
                "classCode": item["classCode"],
                "x": round(item["completionRatio"], 1),
                "y": item["currentGpa"],
                "risk": item["delayRiskScore"],
                "quadrant": item["quadrant"],
                "blinking": item["delayRiskScore"] >= 75,
            }
            for item in students
        ],
        "quadrants": {
            "urgent": "Tin chi thap - GPA thap",
            "credit-watch": "Tin chi thap - GPA tam on",
            "gpa-watch": "Tin chi on - GPA can cai thien",
            "healthy": "Vung an toan",
        },
    }


@app.get("/ai/predictive/gpa-lines")
def predictive_gpa_lines(
    classCode: str | None = None,
    mssv: str | None = None,
    limit: int = 5,
    user: CurrentUser = Depends(require_auth),
) -> dict[str, Any]:
    return gpa_lines_data(user, classCode, mssv, limit)


@app.get("/ai/anomalies/patterns")
def anomaly_patterns(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    rows = query(
        """
        SELECT
          c.course_code AS "antecedentCode",
          c.course_name AS "antecedentName",
          COUNT(*)::int AS "supportCount",
          ROUND(AVG(CASE WHEN e.final_score < 5 THEN 1 ELSE 0 END)::numeric, 2) AS fail_ratio
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN classes cl ON cl.id = s.class_id
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN courses c ON c.id = co.course_id
        WHERE cl.class_code = ANY(%s)
        GROUP BY c.course_code, c.course_name
        HAVING AVG(CASE WHEN e.final_score < 5 THEN 1 ELSE 0 END) > 0.08
        ORDER BY fail_ratio DESC, "supportCount" DESC
        LIMIT 5
        """,
        (allowed_codes,),
    )
    patterns = []
    for row in rows:
        confidence = float(row["fail_ratio"] or 0)
        patterns.append(
            {
                **row,
                "consequentCode": None,
                "consequentName": None,
                "confidence": confidence,
                "message": f"Mon {row['antecedentName']} co ty le diem duoi 5 la {round(confidence * 100, 1)}%.",
            }
        )
    return patterns


@app.get("/ai/anomalies/briefs")
def anomaly_briefs(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    briefs: list[dict[str, Any]] = []
    for class_row in get_accessible_classes(user):
        students = fetch_risk_students(user, class_row["class_code"])
        average_score_row = (
            query_one(
                """
            SELECT ROUND(AVG(e.final_score)::numeric, 2) AS average_score
            FROM enrollments e
            JOIN students s ON s.id = e.student_id
            JOIN classes c ON c.id = s.class_id
            WHERE c.class_code = %s
            """,
                (class_row["class_code"],),
            )
            or {"average_score": 0}
        )
        metrics = {
            "studentCount": len(students),
            "failedNow": len([item for item in students if item["failedCourses"] > 0]),
            "borderline": len(
                [item for item in students if item["riskBand"] == "medium"]
            ),
            "averageScore": float(average_score_row["average_score"] or 0),
            "highRiskCount": len(
                [item for item in students if item["riskBand"] in {"high", "critical"}]
            ),
            "topRiskStudent": students[0]["fullName"] if students else None,
        }
        priority = "critical" if metrics["highRiskCount"] >= 3 else "watch"
        payload = build_llm_brief_payload(class_row["class_code"], students, metrics)
        summary = llm_brief(payload)
        if not summary:
            if students:
                summary = (
                    f"Lop {class_row['class_code']} co {metrics['highRiskCount']} sinh vien rui ro cao, "
                    f"can uu tien {students[0]['fullName']} voi diem rui ro {students[0]['delayRiskScore']}%."
                )
            else:
                summary = f"Lop {class_row['class_code']} dang on dinh, chua ghi nhan diem rui ro bat thuong."
        execute("DELETE FROM ai_briefs WHERE class_id = %s", (class_row["id"],))
        execute(
            """
            INSERT INTO ai_briefs (class_id, title, summary, priority)
            VALUES (%s, %s, %s, %s)
            """,
            (
                class_row["id"],
                f"AI brief {class_row['class_code']}",
                summary,
                priority,
            ),
        )
        briefs.append(
            {
                "classCode": class_row["class_code"],
                "summary": summary,
                "priority": priority,
                "metrics": metrics,
            }
        )
    return briefs


@app.post("/ai/chat-to-data")
def chat_to_data(
    payload: ChatPayload, user: CurrentUser = Depends(require_auth)
) -> dict[str, Any]:
    conversational_answer = small_talk_answer(payload.message)
    if conversational_answer:
        return {
            "mode": "assistant",
            "message": payload.message,
            "plan": {"tool": "small_talk", "params": {}},
            "answer": conversational_answer,
            "sqlPreview": None,
            "rows": [],
            "visualization": {"type": "none"},
            "llmEnabled": any(
                resolve_llm(provider) is not None for provider in provider_order()
            ),
            "provider": LLM_PROVIDER,
        }

    class_codes = [row["class_code"] for row in get_accessible_classes(user)]
    plan = plan_chat_query(payload.message, class_codes)
    result = execute_chat_plan(plan, user, payload.message)
    return {
        "mode": "data",
        "message": payload.message,
        "plan": plan,
        "answer": result["answer"],
        "sqlPreview": result.get("sqlPreview"),
        "rows": result["rows"],
        "visualization": result["visualization"],
        "llmEnabled": any(
            resolve_llm(provider) is not None for provider in provider_order()
        ),
        "provider": LLM_PROVIDER,
    }


@app.get("/admin/import-jobs/recent")
def recent_import_jobs(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    return query(
        """
        SELECT
          id::text,
          source_name AS "sourceName",
          status,
          started_at::text AS "startedAt",
          finished_at::text AS "finishedAt",
          records_processed::int AS "recordsProcessed",
          error_message AS "errorMessage",
          created_by AS "createdBy",
          created_at::text AS "createdAt"
        FROM import_jobs
        ORDER BY created_at DESC
        LIMIT 12
        """
    )


@app.post("/admin/import-jobs/trigger")
def trigger_import(
    payload: ImportPayload, user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER", "ADVISOR"))
) -> dict[str, Any]:
    row = query_one(
        """
        INSERT INTO import_jobs (source_name, status, created_by, daa_cookie)
        VALUES (%s, 'queued', %s, %s)
        RETURNING id, source_name, status, created_at
        """,
        (payload.sourceName, user.username, payload.daaCookie or None),
    )
    return row or {}


# --- DAA Demo Routes (Mirrored from daa_main.py for easy demo access) ---

@app.get("/daa-demo/offerings")
def daa_demo_offerings(
    user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER", "ADVISOR"))
) -> list[dict[str, Any]]:
    if user.role == "DEAN_ADMIN":
        params: tuple[Any, ...] = ()
        lecturer_filter = "WHERE co.lecturer_user_id IS NOT NULL"
    elif user.role == "LECTURER":
        params = (user.user_id,)
        lecturer_filter = "WHERE co.lecturer_user_id = %s"
    else:  # ADVISOR
        params = (user.user_id,)
        lecturer_filter = "WHERE cl.advisor_user_id = %s"

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
    offering_id: str, user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER", "ADVISOR"))
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
    user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER", "ADVISOR")),
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
    user: CurrentUser = Depends(require_roles("DEAN_ADMIN", "LECTURER", "ADVISOR")),
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
