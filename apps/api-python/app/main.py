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


class ImportPayload(BaseModel):
    sourceName: str = "manual-trigger"


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
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=parse_expires_in_to_seconds(JWT_EXPIRES_IN))
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
        "exp": expires_at,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def write_audit_log(user: CurrentUser | None, action: str, resource_type: str, resource_id: str | None, metadata: dict[str, Any] | None = None) -> None:
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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    return CurrentUser(
        user_id=payload["sub"],
        username=payload["username"],
        role=payload["role"],
        full_name=payload.get("full_name", payload["username"]),
    )


def require_roles(*roles: str):
    def dependency(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
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
        return query("SELECT id, class_code, class_name, required_credits FROM classes ORDER BY class_code")
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
        return query_one("SELECT 1 AS ok FROM classes WHERE id = %s", (class_id,)) is not None
    return (
        query_one(
            "SELECT 1 AS ok FROM classes WHERE id = %s AND advisor_user_id = %s",
            (class_id, user.user_id),
        )
        is not None
    )


def can_access_student(user: CurrentUser, mssv: str) -> bool:
    if user.role == "DEAN_ADMIN":
        return query_one("SELECT 1 AS ok FROM students WHERE mssv = %s", (mssv,)) is not None
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


RISK_SQL = """
WITH student_metrics AS (
  SELECT
    s.id,
    s.mssv,
    s.full_name,
    c.class_code,
    c.required_credits,
    COALESCE(s.current_gpa, 0)::float AS current_gpa,
    COALESCE(SUM(CASE WHEN e.passed THEN cr.credits ELSE 0 END), 0)::float AS completed_credits,
    COALESCE(SUM(CASE WHEN e.passed = FALSE THEN 1 ELSE 0 END), 0)::int AS failed_courses,
    COALESCE(SUM(CASE WHEN e.final_score < 5 THEN 1 ELSE 0 END), 0)::int AS low_score_courses
  FROM students s
  JOIN classes c ON c.id = s.class_id
  LEFT JOIN enrollments e ON e.student_id = s.id
  LEFT JOIN course_offerings co ON co.id = e.course_offering_id
  LEFT JOIN courses cr ON cr.id = co.course_id
  GROUP BY s.id, c.class_code, c.required_credits
),
risk AS (
  SELECT
    *,
    GREATEST(required_credits - completed_credits, 0) AS debt_credits,
    CASE
      WHEN required_credits > 0 THEN completed_credits / required_credits
      ELSE 0
    END AS completion_ratio,
    CASE
      WHEN required_credits > 0 THEN GREATEST(required_credits - completed_credits, 0) / required_credits
      ELSE 0
    END AS debt_ratio,
    LEAST(
      100,
      ROUND(
        (
          LEAST(1, GREATEST(0, (5 - current_gpa) / 5.0)) * 45 +
          LEAST(
            1,
            CASE
              WHEN required_credits > 0 THEN GREATEST(required_credits - completed_credits, 0) / required_credits
              ELSE 0
            END
          ) * 35 +
          LEAST(failed_courses, 4) * 5 +
          LEAST(low_score_courses, 4) * 3
        )::numeric,
        1
      )
    ) AS delay_risk_score
  FROM student_metrics
)
SELECT
  id,
  mssv,
  full_name,
  class_code,
  current_gpa,
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
        "Tín chỉ tích lũy": student["completedCredits"],
        "Tín chỉ còn thiếu": student["debtCredits"],
        "Mức rủi ro (%)": student["delayRiskScore"],
        "Nhóm rủi ro": student["riskBand"],
        "Khuyến nghị": student["recommendedAction"],
    }


def fetch_risk_students(user: CurrentUser, class_code: str | None = None) -> list[dict[str, Any]]:
    class_rows = get_accessible_classes(user)
    allowed_codes = [row["class_code"] for row in class_rows]
    if not allowed_codes:
        return []
    if class_code and class_code not in allowed_codes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Forbidden class scope: {class_code}")

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
        enriched.append(
            {
                "id": row["id"],
                "mssv": row["mssv"],
                "fullName": row["full_name"],
                "classCode": row["class_code"],
                "currentGpa": round(current_gpa, 2),
                "completedCredits": float(row["completed_credits"] or 0),
                "requiredCredits": float(row["required_credits"] or 0),
                "debtCredits": float(row["debt_credits"] or 0),
                "completionRatio": round(completion_ratio, 3),
                "failedCourses": failed_courses,
                "lowScoreCourses": low_score_courses,
                "delayRiskScore": round(score, 1),
                "riskBand": summarize_risk_band(score),
                "quadrant": summarize_quadrant(completion_ratio, current_gpa),
                "recommendedAction": recommend_action(score, failed_courses, low_score_courses),
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
        return ChatGoogleGenerativeAI(model=settings["model"], google_api_key=api_key, temperature=0)
    kwargs: dict[str, Any] = {"model": settings["model"], "api_key": api_key, "temperature": 0}
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
                text = "".join(chunk.get("text", "") for chunk in text if isinstance(chunk, dict))
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
    return None


def extract_course(message: str) -> dict[str, str | None]:
    normalized = normalize_text(message)
    courses = query("SELECT course_code, course_name FROM courses ORDER BY course_name")
    for course in courses:
        course_name = normalize_text(course["course_name"])
        if course_name and course_name in normalized:
            return {"courseCode": course["course_code"], "courseName": course["course_name"]}
        if course["course_code"].lower() in normalized:
            return {"courseCode": course["course_code"], "courseName": course["course_name"]}
    return {"courseCode": None, "courseName": None}


def build_rule_based_plan(message: str, class_codes: list[str] | None = None) -> dict[str, Any]:
    normalized = normalize_text(message)
    class_code = extract_class_code_from_message(message, class_codes or [])
    course = extract_course(message)
    limit_match = re.search(r"\btop\s*(\d+)\b", normalized) or re.search(r"\b(\d+)\s+(?:ban|sinh vien|sv)\b", normalized)
    limit = int(limit_match.group(1)) if limit_match else 5

    if any(token in normalized for token in ["ve", "bieu do", "pho diem", "histogram"]):
        return {"tool": "grade_distribution", "params": {**course, "classCode": class_code}}
    if (
        ("top" in normalized and "gpa" in normalized)
        or any(token in normalized for token in ["tot nhat", "xuat sac nhat", "thanh tich tot nhat", "thanh tich cao nhat"])
    ):
        return {"tool": "top_students", "params": {"classCode": class_code, "limit": limit}}
    if any(token in normalized for token in ["nguy co", "rot mon", "canh bao"]) and (
        course["courseCode"] or course["courseName"]
    ):
        return {"tool": "at_risk_students", "params": {**course, "classCode": class_code}}
    if any(token in normalized for token in ["tong quan", "rui ro", "hoc vu"]):
        return {"tool": "risk_overview", "params": {"classCode": class_code}}
    return {"tool": "risk_overview", "params": {"classCode": class_code}}


def plan_chat_query(message: str, class_codes: list[str] | None = None) -> dict[str, Any]:
    forced_rule_plan = build_rule_based_plan(message, class_codes)
    normalized = normalize_text(message)
    if forced_rule_plan["tool"] == "grade_distribution":
        return forced_rule_plan

    llm_plan = llm_json(
        (
            "Ban la bo lap ke hoach chat-to-data. "
            "Tra ve JSON voi dang {\"tool\": string, \"params\": object}. "
            "Chi duoc chon mot trong cac tool: top_students, at_risk_students, grade_distribution, risk_overview."
        ),
        message,
    )
    if isinstance(llm_plan, dict) and isinstance(llm_plan.get("params"), dict):
        if any(token in normalized for token in ["ve", "bieu do", "pho diem", "histogram"]):
            params = dict(llm_plan.get("params", {}))
            params.update({k: v for k, v in forced_rule_plan["params"].items() if v})
            return {"tool": "grade_distribution", "params": params}
        return llm_plan
    return forced_rule_plan


def build_llm_brief_payload(class_code: str, students: list[dict[str, Any]], metrics: dict[str, Any]) -> str:
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
            "Tra ve JSON dang {\"summary\": \"...\"} bang tieng Viet, toi da 2 cau."
        ),
        payload,
    )
    if isinstance(response, dict) and isinstance(response.get("summary"), str):
        return response["summary"]
    return None


def grade_distribution_rows(course_code: str | None, course_name: str | None, class_code: str | None, allowed_codes: list[str]) -> dict[str, Any]:
    if not course_code and not course_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Can chi ro mon hoc de ve pho diem")

    sql = """
    SELECT
      CONCAT(FLOOR(e.final_score)::int, '-', FLOOR(e.final_score)::int + 0.9) AS bin,
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
    answer = f"Phổ điểm môn {course_name or course_code} có {sum(int(row['count']) for row in rows)} lượt ghi nhận."
    return {
        "answer": answer,
        "rows": rows,
        "visualization": {"type": "bar_chart", "xKey": "bin", "yKey": "count"},
        "sqlPreview": f"-- Pho diem mon {course_name or course_code}",
    }


def execute_chat_plan(plan: dict[str, Any], user: CurrentUser) -> dict[str, Any]:
    params = plan.get("params", {}) if isinstance(plan.get("params"), dict) else {}
    class_code = params.get("classCode")
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    if class_code and class_code not in allowed_codes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Forbidden class scope: {class_code}")

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
        return {
            "answer": f"Đã tìm {len(rows)} sinh viên có thành tích học tập tốt nhất trong phạm vi truy vấn.",
            "rows": rows,
            "visualization": {"type": "table"},
            "sqlPreview": "-- Top sinh viên theo GPA hiện tại",
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
        return {
            "answer": f"Có {len(filtered)} sinh viên đang cần chú ý về nguy cơ rớt môn.",
            "rows": compact_rows,
            "visualization": {"type": "table"},
            "sqlPreview": "-- Nhóm sinh viên nguy cơ rớt môn",
        }

    if plan["tool"] == "grade_distribution":
        return grade_distribution_rows(params.get("courseCode"), params.get("courseName"), class_code, allowed_codes)

    students = fetch_risk_students(user, class_code)
    top = students[:5]
    critical = len([item for item in students if item["riskBand"] == "critical"])
    return {
        "answer": (
            f"Có {len(students)} sinh viên trong tập kết quả, {critical} trường hợp mức nguy cấp. "
            f"Cần ưu tiên {top[0]['fullName']} ({top[0]['mssv']}) với điểm rủi ro {top[0]['delayRiskScore']}%."
            if top
            else "Không có dữ liệu rủi ro trong phạm vi truy cập."
        ),
        "rows": [compact_risk_row(item) for item in top],
        "visualization": {"type": "table"},
        "sqlPreview": "-- Tổng quan rủi ro học vụ",
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "api-python", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/auth/login")
def login(payload: LoginPayload) -> dict[str, Any]:
    user = query_one("SELECT * FROM users WHERE username = %s", (payload.username,))
    if not user or not bcrypt.checkpw(payload.password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai tai khoan hoac mat khau")
    token = sign_token(user)
    write_audit_log(None, "login", "user", str(user["id"]), {"username": payload.username})
    return {"accessToken": token}


@app.get("/classes")
def classes(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    return get_accessible_classes(user)


@app.get("/classes/{class_id}/students")
def class_students(class_id: str, user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    if not can_access_class(user, class_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden class scope")
    return query(
        """
        SELECT id, mssv, full_name, COALESCE(current_gpa, 0)::float AS current_gpa
        FROM students
        WHERE class_id = %s
        ORDER BY mssv
        """,
        (class_id,),
    )


@app.get("/students/{mssv}/dashboard")
def student_dashboard(mssv: str, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope")
    student = query_one(
        """
        SELECT s.id, s.mssv, s.full_name, c.class_code, c.required_credits
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.mssv = %s
        """,
        (mssv,),
    )
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    gpa_trend = query(
        """
        SELECT t.term_code AS "termCode", ROUND(AVG(e.final_score)::numeric, 2) AS gpa
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
    credit_progress = query_one(
        """
        SELECT
          COALESCE(SUM(CASE WHEN e.passed THEN c.credits ELSE 0 END), 0)::float AS completed,
          cl.required_credits::float AS required
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        LEFT JOIN enrollments e ON e.student_id = s.id
        LEFT JOIN course_offerings co ON co.id = e.course_offering_id
        LEFT JOIN courses c ON c.id = co.course_id
        WHERE s.mssv = %s
        GROUP BY cl.required_credits
        """,
        (mssv,),
    ) or {"completed": 0, "required": 0}
    alerts = query(
        """
        SELECT id, alert_type, severity, message, created_at
        FROM alerts
        WHERE student_id = %s
        ORDER BY created_at DESC
        LIMIT 8
        """,
        (student["id"],),
    )
    notes = query(
        """
        SELECT note, created_at
        FROM advisory_notes
        WHERE student_id = %s
        ORDER BY created_at DESC
        LIMIT 10
        """,
        (student["id"],),
    )
    risk_profile = next((item for item in fetch_risk_students(user) if item["mssv"] == mssv), None)
    completed = float(credit_progress["completed"] or 0)
    required = float(credit_progress["required"] or 0)
    return {
        "student": {
            "id": student["id"],
            "mssv": student["mssv"],
            "full_name": student["full_name"],
            "class_code": student["class_code"],
        },
        "gpaTrend": gpa_trend,
        "creditProgress": {
            "completed": completed,
            "required": required,
            "debt": max(required - completed, 0),
        },
        "alerts": alerts,
        "notes": notes,
        "riskProfile": risk_profile,
    }


@app.get("/students/{mssv}/alerts")
def student_alerts(mssv: str, user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    if not can_access_student(user, mssv):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope")
    student = query_one("SELECT id FROM students WHERE mssv = %s", (mssv,))
    return query(
        "SELECT * FROM alerts WHERE student_id = %s ORDER BY created_at DESC",
        (student["id"],),
    )


@app.post("/students/{mssv}/notes")
def add_note(mssv: str, payload: NotePayload, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    if not can_access_student(user, mssv):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden student scope")
    note_text = payload.note.strip()
    if not note_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Note must not be empty")
    student = query_one("SELECT id FROM students WHERE mssv = %s", (mssv,))
    execute(
        """
        INSERT INTO advisory_notes (student_id, advisor_user_id, note)
        VALUES (%s, %s, %s)
        """,
        (student["id"], user.user_id, note_text),
    )
    write_audit_log(user, "create_note", "student", mssv, {"note_length": len(note_text)})
    return {"message": "Note saved"}


@app.get("/analytics/grade-distributions")
def analytics_grade_distribution(courseOfferingId: str, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course offering not found")
    allowed_codes = [row["class_code"] for row in get_accessible_classes(user)]
    if offering["class_code"] not in allowed_codes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden class scope")
    return grade_distribution_rows(offering["course_code"], offering["course_name"], offering["class_code"], allowed_codes)


@app.get("/analytics/graduation-forecast")
def graduation_forecast(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    students = fetch_risk_students(user)
    on_track = len([item for item in students if item["completionRatio"] >= 0.75 and item["currentGpa"] >= 5])
    watchlist = len([item for item in students if item["riskBand"] in {"medium", "high"}])
    critical = len([item for item in students if item["riskBand"] == "critical"])
    return {"onTrack": on_track, "watchlist": watchlist, "critical": critical}


@app.get("/analytics/class-leaderboard")
def class_leaderboard(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
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
            "highRisk": len([item for item in students if item["delayRiskScore"] >= 55]),
            "critical": len([item for item in students if item["delayRiskScore"] >= 75]),
            "alerts": alerts_count,
            "averageRisk": round(sum(item["delayRiskScore"] for item in students) / len(students), 1) if students else 0,
        },
        "topRisks": students[:6],
    }


@app.get("/ai/predictive/students")
def predictive_students(classCode: str | None = None, user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    return fetch_risk_students(user, classCode)


@app.get("/ai/predictive/matrix")
def predictive_matrix(classCode: str | None = None, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    students = fetch_risk_students(user, classCode)
    return {
        "points": [
            {
                "mssv": item["mssv"],
                "fullName": item["fullName"],
                "classCode": item["classCode"],
                "x": round(item["completionRatio"] * 100, 1),
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
        average_score_row = query_one(
            """
            SELECT ROUND(AVG(e.final_score)::numeric, 2) AS average_score
            FROM enrollments e
            JOIN students s ON s.id = e.student_id
            JOIN classes c ON c.id = s.class_id
            WHERE c.class_code = %s
            """,
            (class_row["class_code"],),
        ) or {"average_score": 0}
        metrics = {
            "studentCount": len(students),
            "failedNow": len([item for item in students if item["failedCourses"] > 0]),
            "borderline": len([item for item in students if item["riskBand"] == "medium"]),
            "averageScore": float(average_score_row["average_score"] or 0),
            "highRiskCount": len([item for item in students if item["riskBand"] in {"high", "critical"}]),
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
def chat_to_data(payload: ChatPayload, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    class_codes = [row["class_code"] for row in get_accessible_classes(user)]
    plan = plan_chat_query(payload.message, class_codes)
    result = execute_chat_plan(plan, user)
    return {
        "message": payload.message,
        "plan": plan,
        "answer": result["answer"],
        "sqlPreview": result.get("sqlPreview"),
        "rows": result["rows"],
        "visualization": result["visualization"],
        "llmEnabled": any(resolve_llm(provider) is not None for provider in provider_order()),
        "provider": LLM_PROVIDER,
    }


@app.post("/admin/import-jobs/trigger")
def trigger_import(payload: ImportPayload, user: CurrentUser = Depends(require_roles("DEAN_ADMIN"))) -> dict[str, Any]:
    row = query_one(
        """
        INSERT INTO import_jobs (source_name, status, created_by)
        VALUES (%s, 'queued', %s)
        RETURNING id, source_name, status, created_at
        """,
        (payload.sourceName, user.username),
    )
    return row or {}
