import logging
import os
import sys

import bcrypt
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    logger.error("DATABASE_URL is required")
    sys.exit(1)


def grade(score: float) -> str:
    if score >= 8.5:
        return "A"
    if score >= 7.0:
        return "B"
    if score >= 5.5:
        return "C"
    if score >= 4.0:
        return "D"
    return "F"


try:
    logger.info("Starting seed data initialization")
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("BEGIN")

            admin_hash = bcrypt.hashpw("admin123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            advisor_hash = bcrypt.hashpw("advisor123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

            logger.info("Inserting admin and advisor users")
            cur.execute(
                """
                INSERT INTO users (username, password_hash, role, full_name, email)
                VALUES ('dean_admin', %s, 'DEAN_ADMIN', 'Dean Admin', 'admin@cvht.local')
                ON CONFLICT (username) DO UPDATE SET
                  password_hash = EXCLUDED.password_hash,
                  full_name = EXCLUDED.full_name,
                  email = EXCLUDED.email
                """,
                (admin_hash,),
            )

            cur.execute(
                """
                INSERT INTO users (username, password_hash, role, full_name, email)
                VALUES ('advisor_1', %s, 'ADVISOR', 'Nguyen Van Advisor', 'advisor@cvht.local')
                ON CONFLICT (username) DO UPDATE SET
                  password_hash = EXCLUDED.password_hash,
                  full_name = EXCLUDED.full_name,
                  email = EXCLUDED.email
                """,
                (advisor_hash,),
            )

            logger.info("Inserting classes")
            cur.execute(
                """
                INSERT INTO classes (class_code, class_name, advisor_user_id, required_credits)
                VALUES
                  ('CNTT-K18A', 'Cong nghe thong tin K18A', (SELECT id FROM users WHERE username = 'advisor_1'), 36),
                  ('CNTT-K18B', 'Cong nghe thong tin K18B', (SELECT id FROM users WHERE username = 'advisor_1'), 36)
                ON CONFLICT (class_code) DO UPDATE SET
                  class_name = EXCLUDED.class_name,
                  advisor_user_id = EXCLUDED.advisor_user_id,
                  required_credits = EXCLUDED.required_credits
                """
            )

            logger.info("Inserting terms")
            cur.execute(
                """
                INSERT INTO terms (term_code, term_name, start_date, end_date)
                VALUES
                  ('2025-1', 'Hoc ky 1 nam hoc 2025-2026', '2025-09-01', '2026-01-15'),
                  ('2025-2', 'Hoc ky 2 nam hoc 2025-2026', '2026-02-01', '2026-06-15')
                ON CONFLICT (term_code) DO UPDATE SET
                  term_name = EXCLUDED.term_name,
                  start_date = EXCLUDED.start_date,
                  end_date = EXCLUDED.end_date
                """
            )

            logger.info("Inserting courses")
            cur.execute(
                """
                INSERT INTO courses (course_code, course_name, credits)
                VALUES
                  ('MTH101', 'Giai tich 1', 3),
                  ('PHY101', 'Vat ly dai cuong', 3),
                  ('PRG101', 'Nhap mon lap trinh', 3),
                  ('DBI201', 'Co so du lieu', 3),
                  ('NET201', 'Mang may tinh', 3),
                  ('SE201', 'Ky thuat phan mem', 3)
                ON CONFLICT (course_code) DO UPDATE SET
                  course_name = EXCLUDED.course_name,
                  credits = EXCLUDED.credits
                """
            )

            logger.info("Inserting students")
            cur.execute(
                """
                WITH class_rows AS (
                  SELECT id, class_code FROM classes WHERE class_code IN ('CNTT-K18A', 'CNTT-K18B')
                )
                INSERT INTO students (mssv, full_name, class_id, english_level)
                SELECT
                  'SV' || LPAD(gs::text, 3, '0') AS mssv,
                  'Sinh vien ' || gs::text,
                  CASE WHEN gs <= 15
                    THEN (SELECT id FROM class_rows WHERE class_code = 'CNTT-K18A')
                    ELSE (SELECT id FROM class_rows WHERE class_code = 'CNTT-K18B')
                  END,
                  CASE
                    WHEN gs % 3 = 0 THEN 'B2'
                    WHEN gs % 2 = 0 THEN 'B1'
                    ELSE 'A2'
                  END
                FROM generate_series(1, 30) AS gs
                ON CONFLICT (mssv) DO UPDATE SET
                  full_name = EXCLUDED.full_name,
                  class_id = EXCLUDED.class_id,
                  english_level = EXCLUDED.english_level
                """
            )

            logger.info("Inserting course offerings")
            cur.execute(
                """
                WITH t1 AS (SELECT id FROM terms WHERE term_code = '2025-1'),
                t2 AS (SELECT id FROM terms WHERE term_code = '2025-2'),
                c1 AS (SELECT id FROM courses WHERE course_code IN ('MTH101', 'PHY101', 'PRG101')),
                c2 AS (SELECT id FROM courses WHERE course_code IN ('DBI201', 'NET201', 'SE201'))
                INSERT INTO course_offerings (course_id, term_id, class_id, lecturer_name)
                SELECT c1.id, t1.id, cl.id, 'Giang vien A'
                FROM c1 CROSS JOIN t1 CROSS JOIN classes cl
                UNION ALL
                SELECT c2.id, t2.id, cl.id, 'Giang vien B'
                FROM c2 CROSS JOIN t2 CROSS JOIN classes cl
                ON CONFLICT (course_id, class_id, term_id) DO UPDATE SET
                  lecturer_name = EXCLUDED.lecturer_name
                """
            )

            logger.info("Inserting enrollments and scores")
            cur.execute(
                """
                SELECT
                  s.id AS student_id,
                  s.mssv,
                  co.id AS course_offering_id,
                  t.term_code,
                  c.course_code
                FROM students s
                JOIN course_offerings co ON co.class_id = s.class_id
                JOIN courses c ON c.id = co.course_id
                JOIN terms t ON t.id = co.term_id
                """
            )
            enrollment_rows = cur.fetchall()

            for row in enrollment_rows:
                idx = int(str(row["mssv"])[2:])
                score = 6.2 + (idx % 4) + (ord(str(row["course_code"])[0]) % 2) * 0.35
                midterm = max(2.0, min(9.5, score - 0.4))

                if row["mssv"] == "SV001" and row["term_code"] == "2025-1" and row["course_code"] == "PRG101":
                    score = 3.6
                if row["mssv"] == "SV001" and row["term_code"] == "2025-2" and row["course_code"] == "DBI201":
                    score = 3.2
                if row["mssv"] == "SV001" and row["term_code"] == "2025-2" and row["course_code"] == "SE201":
                    score = 4.1
                if row["mssv"] == "SV002" and row["term_code"] == "2025-1" and row["course_code"] == "PRG101":
                    score = 4.2
                if row["mssv"] == "SV002" and row["term_code"] == "2025-2" and row["course_code"] == "NET201":
                    score = 4.3
                if row["mssv"] == "SV002" and row["term_code"] == "2025-2" and row["course_code"] == "DBI201":
                    score = 4.8
                if row["mssv"] == "SV003" and row["term_code"] == "2025-2" and row["course_code"] == "DBI201":
                    score = 5.1
                if row["mssv"] == "SV004" and row["term_code"] == "2025-2" and row["course_code"] == "SE201":
                    score = 5.0
                if row["mssv"] == "SV016" and row["term_code"] == "2025-2" and row["course_code"] == "NET201":
                    score = 3.9
                if row["mssv"] == "SV016" and row["term_code"] == "2025-2" and row["course_code"] == "DBI201":
                    score = 4.6

                score = min(9.8, max(2.5, score))
                passed = score >= 4.0

                cur.execute(
                    """
                    INSERT INTO enrollments (
                      student_id,
                      course_offering_id,
                      attempt_no,
                      midterm_score,
                      final_score,
                      letter_grade,
                      passed,
                      is_retake
                    )
                    VALUES (%s, %s, 1, %s, %s, %s, %s, %s)
                    ON CONFLICT (student_id, course_offering_id)
                    DO UPDATE SET
                      midterm_score = EXCLUDED.midterm_score,
                      final_score = EXCLUDED.final_score,
                      letter_grade = EXCLUDED.letter_grade,
                      passed = EXCLUDED.passed,
                      is_retake = EXCLUDED.is_retake
                    """,
                    (
                        row["student_id"],
                        row["course_offering_id"],
                        round(midterm, 2),
                        round(score, 2),
                        grade(score),
                        passed,
                        not passed,
                    ),
                )

            logger.info("Clearing temporary tables")
            cur.execute("DELETE FROM alerts")
            cur.execute("DELETE FROM advisory_notes")
            cur.execute("DELETE FROM risk_snapshots")
            cur.execute("DELETE FROM ai_briefs")

            logger.info("Computing GPA from enrollments")
            cur.execute(
                """
                UPDATE students s
                SET current_gpa = stats.avg_score
                FROM (
                  SELECT s2.id, ROUND(AVG(e.final_score)::numeric, 2) AS avg_score
                  FROM students s2
                  JOIN enrollments e ON e.student_id = s2.id
                  GROUP BY s2.id
                ) AS stats
                WHERE stats.id = s.id
                """
            )
            
            conn.commit()
            logger.info("Seed data completed successfully")

except Exception as e:
    logger.error(f"Seed data failed: {str(e)}", exc_info=True)
    sys.exit(1)
