import logging
import os
import sys
from dataclasses import dataclass
from typing import Any, Literal

import bcrypt
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor, execute_values

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    logger.error("DATABASE_URL is required")
    sys.exit(1)

ProgramCode = Literal["ATTT", "MMT"]
TrainingSystem = Literal["Đại trà", "Tài năng"]
Profile = Literal["strong", "normal", "slow", "risky"]
AcademicStatus = Literal["studying", "delayed", "graduated"]

COHORTS = [2021, 2022, 2023, 2024, 2025]
TERMS = []
for idx in range(10):
    term = idx + 1
    academic_year = 2021 + ((term - 1) // 2)
    is_odd = term % 2 == 1
    TERMS.append(
        {
            "code": f"HK{term}",
            "name": f"Học kỳ {term}",
            "start": f"{academic_year if is_odd else academic_year + 1}-{'09' if is_odd else '02'}-01",
            "end": f"{academic_year + 1}-{'01' if is_odd else '06'}-15",
        }
    )


@dataclass(frozen=True)
class CourseSpec:
    code: str
    name: str
    credits: int
    term: int
    programs: tuple[ProgramCode, ...]
    difficulty: float = 0.0


@dataclass(frozen=True)
class ClassSeed:
    code: str
    name: str
    program: ProgramCode
    training: TrainingSystem
    cohort: int
    required_credits: int
    advisor_index: int


@dataclass(frozen=True)
class DraftStudent:
    full_name: str
    class_code: str
    class_id: str
    program: ProgramCode
    training: TrainingSystem
    cohort: int
    english_level: str
    class_rank: int
    risk_quota: int
    sort_key: str


@dataclass(frozen=True)
class StudentSeed:
    mssv: str
    full_name: str
    class_code: str
    class_id: str
    program: ProgramCode
    training: TrainingSystem
    cohort: int
    profile: Profile
    academic_status: AcademicStatus
    english_level: str


COURSES: list[CourseSpec] = [
    CourseSpec("ENG01", "Anh văn 1", 4, 1, ("ATTT", "MMT")),
    CourseSpec("IT001", "Nhập môn lập trình", 4, 1, ("ATTT", "MMT")),
    CourseSpec("MA003", "Đại số tuyến tính", 3, 1, ("ATTT", "MMT")),
    CourseSpec("MA006", "Giải tích", 4, 1, ("ATTT", "MMT"), 0.4),
    CourseSpec("PH002", "Nhập môn mạch số", 4, 1, ("ATTT", "MMT"), 0.2),
    CourseSpec("SS004", "Kỹ năng nghề nghiệp", 2, 1, ("ATTT", "MMT")),
    CourseSpec("NT015", "Giới thiệu ngành An toàn thông tin", 1, 1, ("ATTT",)),
    CourseSpec("NT016", "Giới thiệu ngành MMT&TTDL", 1, 1, ("MMT",)),
    CourseSpec("IT003", "Cấu trúc dữ liệu và giải thuật", 4, 2, ("ATTT", "MMT"), 0.35),
    CourseSpec("IT005", "Nhập môn mạng máy tính", 4, 2, ("ATTT", "MMT")),
    CourseSpec("IT006", "Kiến trúc máy tính", 3, 2, ("ATTT", "MMT"), 0.15),
    CourseSpec("MA004", "Cấu trúc rời rạc", 4, 2, ("ATTT", "MMT"), 0.3),
    CourseSpec("MA005", "Xác suất thống kê", 3, 2, ("ATTT", "MMT"), 0.35),
    CourseSpec("SS003", "Tư tưởng Hồ Chí Minh", 2, 2, ("ATTT", "MMT")),
    CourseSpec("SS006", "Pháp luật đại cương", 2, 2, ("ATTT", "MMT")),
    CourseSpec("SS008", "Kinh tế chính trị Mác - Lênin", 2, 2, ("ATTT", "MMT")),
    CourseSpec("IT002", "Lập trình hướng đối tượng", 4, 3, ("ATTT", "MMT"), 0.25),
    CourseSpec("IT004", "Cơ sở dữ liệu", 4, 3, ("ATTT", "MMT")),
    CourseSpec("IT007", "Hệ điều hành", 4, 3, ("ATTT", "MMT"), 0.45),
    CourseSpec("SS007", "Triết học Mác - Lênin", 3, 3, ("ATTT", "MMT")),
    CourseSpec("SS009", "Chủ nghĩa xã hội khoa học", 2, 3, ("ATTT", "MMT")),
    CourseSpec("SS010", "Lịch sử Đảng Cộng sản Việt Nam", 2, 3, ("ATTT", "MMT")),
    CourseSpec("NT209", "Lập trình hệ thống", 3, 3, ("ATTT",), 0.35),
    CourseSpec("NT219", "Mật mã học", 3, 3, ("ATTT",), 0.5),
    CourseSpec("MMT201", "Lập trình mạng căn bản", 3, 3, ("MMT",), 0.25),
    CourseSpec("MMT202", "Truyền dữ liệu", 4, 3, ("MMT",), 0.35),
    CourseSpec("ENG02", "Anh văn 2", 4, 4, ("ATTT", "MMT")),
    CourseSpec("ENG03", "Anh văn 3", 4, 4, ("ATTT", "MMT")),
    CourseSpec("NT101", "An toàn mạng", 4, 4, ("ATTT",), 0.4),
    CourseSpec("NT102", "Quản trị mạng và hệ thống", 4, 4, ("ATTT", "MMT"), 0.3),
    CourseSpec("NT103", "Lập trình mạng căn bản", 3, 4, ("ATTT",), 0.25),
    CourseSpec("MMT203", "An toàn Mạng máy tính", 4, 4, ("MMT",), 0.35),
    CourseSpec("MMT204", "Hệ thống nhúng mạng không dây", 4, 4, ("MMT",), 0.35),
    CourseSpec("MMT205", "Thiết kế mạng", 3, 4, ("MMT",)),
    CourseSpec("NT104", "Cơ chế hoạt động của mã độc", 3, 5, ("ATTT",), 0.55),
    CourseSpec("NT105", "Lập trình ứng dụng Web", 3, 5, ("ATTT",), 0.2),
    CourseSpec("NT106", "Lập trình an toàn và khai thác lỗ hổng phần mềm", 4, 5, ("ATTT",), 0.55),
    CourseSpec("NT201", "Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập", 3, 5, ("ATTT",), 0.45),
    CourseSpec("NT202", "An toàn mạng không dây và di động", 3, 5, ("ATTT",), 0.35),
    CourseSpec("NT203", "Quản lý rủi ro và an toàn thông tin trong doanh nghiệp", 3, 5, ("ATTT",)),
    CourseSpec("MMT301", "Đánh giá hiệu năng hệ thống mạng máy tính", 3, 5, ("MMT",), 0.35),
    CourseSpec("MMT302", "Công nghệ Internet of Things hiện đại", 3, 5, ("MMT",), 0.25),
    CourseSpec("MMT303", "Hệ tính toán phân bố", 3, 5, ("MMT",), 0.45),
    CourseSpec("MMT304", "Phát triển ứng dụng trên thiết bị di động", 3, 5, ("MMT",)),
    CourseSpec("MMT305", "Công nghệ truyền thông đa phương tiện", 3, 5, ("MMT",)),
    CourseSpec("NT204", "Kỹ thuật phân tích mã độc", 3, 6, ("ATTT",), 0.55),
    CourseSpec("NT205", "Bảo mật web và ứng dụng", 3, 6, ("ATTT",), 0.35),
    CourseSpec("NT206", "Pháp chứng kỹ thuật số", 3, 6, ("ATTT",), 0.4),
    CourseSpec("NT207", "An toàn mạng máy tính nâng cao", 3, 6, ("ATTT",), 0.5),
    CourseSpec("NT208", "Bảo mật Internet of Things", 3, 6, ("ATTT",), 0.35),
    CourseSpec("MMT306", "Công nghệ mạng viễn thông", 3, 6, ("MMT",)),
    CourseSpec("MMT307", "Giải thuật xử lý song song và phân bố", 3, 6, ("MMT",), 0.5),
    CourseSpec("MMT308", "Mạng không dây thế hệ mới", 3, 6, ("MMT",)),
    CourseSpec("MMT309", "Lập trình kịch bản tự động hóa cho quản trị và bảo mật mạng", 3, 6, ("MMT",), 0.35),
    CourseSpec("NT210", "An ninh nhân sự, định danh và chứng thực", 3, 7, ("ATTT",)),
    CourseSpec("NT211", "An toàn dữ liệu, khôi phục thông tin sau sự cố", 3, 7, ("ATTT",), 0.25),
    CourseSpec("NT212", "An toàn kiến trúc hệ thống", 3, 7, ("ATTT",), 0.3),
    CourseSpec("NT213", "Blockchain: nền tảng, ứng dụng và bảo mật", 3, 7, ("ATTT",), 0.35),
    CourseSpec("NT214", "Phát triển ứng dụng trên thiết bị di động", 3, 7, ("ATTT",), 0.2),
    CourseSpec("MMT310", "Tín hiệu và hệ thống thông tin", 3, 7, ("MMT",), 0.3),
    CourseSpec("MMT311", "Bảo mật Internet of Things", 3, 7, ("MMT",), 0.35),
    CourseSpec("MMT312", "Thiết kế hệ thống viễn thông", 3, 7, ("MMT",)),
    CourseSpec("MMT313", "Thiết kế và triển khai mạng tốc độ cao", 3, 7, ("MMT",), 0.25),
    CourseSpec("ELE001", "Tự chọn tự do 1", 3, 5, ("ATTT", "MMT")),
    CourseSpec("ELE002", "Tự chọn tự do 2", 3, 6, ("ATTT", "MMT")),
    CourseSpec("PRJ401", "Đồ án chuyên ngành", 2, 7, ("ATTT", "MMT"), 0.2),
    CourseSpec("INT401", "Thực tập doanh nghiệp", 2, 7, ("ATTT", "MMT")),
    CourseSpec("GRD401", "Khóa luận tốt nghiệp", 10, 8, ("ATTT", "MMT"), 0.25),
]

ATTT_MAJOR_ELECTIVES = {
    "NT201",
    "NT202",
    "NT203",
    "NT204",
    "NT205",
    "NT206",
    "NT207",
    "NT208",
    "NT210",
    "NT211",
    "NT212",
    "NT213",
    "NT214",
}
MMT_MAJOR_ELECTIVES = {
    "MMT301",
    "MMT302",
    "MMT303",
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


def grade(score: float) -> str:
    if score >= 8.5:
        return "A"
    if score >= 7.0:
        return "B"
    if score >= 5.5:
        return "C"
    if score >= 5.0:
        return "D"
    return "F"


def hash_string(value: str) -> int:
    result = 0
    for char in value:
        result = (result * 31 + ord(char)) % 1_000_003
    return result


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def risk_band(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def risk_quadrant(completion_percent: float, gpa: float) -> str:
    if completion_percent < 50 and gpa < 5:
        return "credit_low_gpa_low"
    if completion_percent < 50 and gpa >= 5:
        return "credit_low_gpa_ok"
    if completion_percent >= 50 and gpa < 5:
        return "credit_ok_gpa_low"
    return "safe_zone"


def completed_terms_for_cohort(cohort: int) -> int:
    if cohort >= 2025:
        return 2
    if cohort == 2024:
        return 4
    if cohort == 2023:
        return 6
    if cohort == 2022:
        return 7
    return 10


def program_required_credits(program: ProgramCode) -> int:
    return 129 if program == "ATTT" else 130


def risk_quota_for_class(class_code: str, class_size: int) -> int:
    return 1 + (hash_string(f"{class_code}-risk-quota") % min(10, class_size))


def profile_for_class_rank(class_code: str, rank: int, risk_quota: int) -> Profile:
    if rank <= risk_quota:
        return "risky" if hash_string(f"{class_code}-{rank}-risk-depth") % 3 == 0 else "slow"
    return "strong" if hash_string(f"{class_code}-{rank}-profile") % 100 < 36 else "normal"


def initial_academic_status(mssv: str, cohort: int, profile: Profile) -> AcademicStatus:
    value = hash_string(f"{mssv}-status") % 100
    if cohort == 2021 and profile not in {"slow", "risky"}:
        return "graduated" if value < 72 else "studying"
    if cohort == 2022 and profile == "strong" and value < 6:
        return "graduated"
    if cohort == 2021 or profile in {"slow", "risky"}:
        return "delayed"
    return "studying"


def score_for(student: StudentSeed, course: CourseSpec, attempt_no: int) -> float:
    base = {"strong": 8.2, "normal": 7.1, "slow": 6.1, "risky": 5.4}[student.profile]
    training_bonus = 0.35 if student.training == "Tài năng" else 0
    noise = ((hash_string(f"{student.mssv}-{course.code}-{attempt_no}") % 31) - 15) / 10
    retry_bonus = 1.1 if attempt_no > 1 else 0
    return round(clamp(base + training_bonus + noise + retry_bonus - course.difficulty, 2.0, 9.8), 1)


def should_fail(student: StudentSeed, course: CourseSpec) -> bool:
    if student.academic_status == "graduated" or student.profile in {"strong", "normal"}:
        return False
    base = 7 if student.profile == "risky" else 3
    difficulty_boost = round(course.difficulty * 3)
    return hash_string(f"{student.mssv}-{course.code}-fail") % 100 < base + difficulty_boost


def should_skip(student: StudentSeed, course: CourseSpec, available_terms: int) -> bool:
    if student.academic_status == "graduated":
        return False
    if course.term > available_terms:
        return True
    if course.term <= 3:
        return False
    if student.profile in {"strong", "normal"}:
        return False
    base = 13 if student.profile == "risky" else 7
    senior_boost = 4 if student.cohort == 2021 else 0
    return hash_string(f"{student.mssv}-{course.code}-skip") % 100 < base + senior_boost


def selected_major_elective_codes(student: StudentSeed) -> set[str]:
    pool = sorted(ATTT_MAJOR_ELECTIVES if student.program == "ATTT" else MMT_MAJOR_ELECTIVES)
    buckets: dict[int, list[str]] = {}
    course_by_code = {course.code: course for course in COURSES}
    for code in pool:
        buckets.setdefault(course_by_code[code].term, []).append(code)

    # Spread elective choices across semesters so generated transcripts look like
    # realistic study plans instead of piling all electives into one late term.
    term_plan = [5, 6, 7] if student.program == "ATTT" else [5, 5, 6, 7]
    selected: set[str] = set()
    for term in term_plan:
        candidates = [code for code in buckets.get(term, []) if code not in selected]
        if not candidates:
            candidates = [code for code in pool if code not in selected]
        ranked = sorted(
            candidates,
            key=lambda code: hash_string(f"{student.mssv}-{code}-major-elective"),
        )
        if ranked:
            selected.add(ranked[0])
    return selected


def delayed_planned_term(student: StudentSeed, course: CourseSpec) -> int:
    if course.code == "GRD401":
        return 9 if hash_string(f"{student.mssv}-late-graduation-term") % 100 < 35 else 10
    if course.code in {"PRJ401", "INT401"}:
        return 8
    if course.term <= 4:
        choices = [5, 6]
    elif course.term == 5:
        choices = [6, 7]
    elif course.term == 6:
        choices = [7, 8]
    else:
        choices = [7, 8, 9]
    return choices[hash_string(f"{student.mssv}-{course.code}-delayed-term") % len(choices)]


def make_full_name(seed: str) -> str:
    last_names = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Mai", "Huỳnh", "Võ", "Dương", "Lý"]
    middle_names = ["Minh", "Ngọc", "Thanh", "Đức", "Thu", "Quang", "Anh", "Gia", "Bảo", "Hải", "Khánh", "Nhật", "Hoài", "Tấn", "Kim", "Tuấn"]
    first_names = ["An", "Bình", "Chi", "Dũng", "Giang", "Huy", "Khánh", "Linh", "Nam", "Phương", "Thảo", "Vy", "Khoa", "Tâm", "Nhi", "Long", "Trí", "My"]
    second_first_names = ["Minh", "Anh", "Bảo", "Gia", "Hữu", "Khánh", "Nhật", "Quốc", "Thành", "Tuệ"]
    h = hash_string(seed)
    return f"{last_names[h % len(last_names)]} {middle_names[(h + 5) % len(middle_names)]} {second_first_names[(h + 11) % len(second_first_names)]} {first_names[(h + 17) % len(first_names)]}"


def build_classes(advisor_count: int) -> list[ClassSeed]:
    rows: list[ClassSeed] = []
    advisor_index = 0
    for cohort in COHORTS:
        rows.append(ClassSeed(f"ATTN{cohort}", f"An toàn thông tin Tài năng {cohort}", "ATTT", "Tài năng", cohort, program_required_credits("ATTT"), advisor_index % advisor_count))
        advisor_index += 1
        for group in range(1, 4):
            rows.append(ClassSeed(f"ATTT{cohort}.{group}", f"An toàn thông tin {cohort}.{group}", "ATTT", "Đại trà", cohort, program_required_credits("ATTT"), advisor_index % advisor_count))
            advisor_index += 1
        for group in range(1, 5):
            rows.append(ClassSeed(f"MMT&TT{cohort}.{group}", f"Mạng máy tính & Truyền thông dữ liệu {cohort}.{group}", "MMT", "Đại trà", cohort, program_required_credits("MMT"), advisor_index % advisor_count))
            advisor_index += 1
    return rows


def make_mssv(cohort: int, index: int) -> str:
    return f"{str(cohort)[-2:]}52{index:04d}"


def old_class_style_mssv(class_seed: ClassSeed, index: int) -> str:
    yy = str(class_seed.cohort)[-2:]
    program_part = "AN" if class_seed.training == "Tài năng" else "AT" if class_seed.program == "ATTT" else "MM"
    group_part = "T" if class_seed.training == "Tài năng" else class_seed.code.split(".")[-1]
    return f"{yy}{program_part}{group_part}{index:03d}"


def build_students(class_rows: list[ClassSeed], class_id_by_code: dict[str, str]) -> list[StudentSeed]:
    drafts: list[DraftStudent] = []
    for class_seed in class_rows:
        count = 30 if class_seed.training == "Tài năng" else 70
        class_drafts: list[dict[str, Any]] = []
        for index in range(1, count + 1):
            full_name = "Phan Lâm Dũng" if class_seed.code == "ATTN2024" and index == 1 else make_full_name(f"{class_seed.code}-{index}")
            class_drafts.append(
                {
                    "full_name": full_name,
                    "english_level": "B1" if hash_string(f"{old_class_style_mssv(class_seed, index)}-eng") % 3 == 0 else "A2",
                    "original_index": index,
                }
            )
        risk_quota = risk_quota_for_class(class_seed.code, count)
        class_drafts.sort(key=lambda row: (row["full_name"], row["original_index"]))
        for rank, draft in enumerate(class_drafts, start=1):
            drafts.append(
                DraftStudent(
                    full_name=draft["full_name"],
                    class_code=class_seed.code,
                    class_id=class_id_by_code[class_seed.code],
                    program=class_seed.program,
                    training=class_seed.training,
                    cohort=class_seed.cohort,
                    english_level="Miễn" if draft["full_name"] == "Phan Lâm Dũng" and class_seed.code == "ATTN2024" else draft["english_level"],
                    class_rank=rank,
                    risk_quota=risk_quota,
                    sort_key=f"{draft['full_name']}|{class_seed.code}|{draft['original_index']:03d}",
                )
            )

    students: list[StudentSeed] = []
    for cohort in COHORTS:
        cohort_drafts = sorted([draft for draft in drafts if draft.cohort == cohort], key=lambda draft: draft.sort_key)
        for index, draft in enumerate(cohort_drafts, start=1):
            mssv = make_mssv(cohort, index)
            profile = profile_for_class_rank(draft.class_code, draft.class_rank, draft.risk_quota)
            academic_status = "studying" if draft.full_name == "Phan Lâm Dũng" and draft.class_code == "ATTN2024" else initial_academic_status(mssv, draft.cohort, profile)
            students.append(
                StudentSeed(
                    mssv=mssv,
                    full_name=draft.full_name,
                    class_code=draft.class_code,
                    class_id=draft.class_id,
                    program=draft.program,
                    training=draft.training,
                    cohort=draft.cohort,
                    profile=profile,
                    academic_status=academic_status,
                    english_level=draft.english_level,
                )
            )
    return students


def build_enrollment_rows(students: list[StudentSeed], student_id_by_mssv: dict[str, str], offering_by_key: dict[str, str]) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    student_by_id: dict[str, StudentSeed] = {}
    program_courses_by_student_id: dict[str, list[CourseSpec]] = {}
    offering_meta_by_id: dict[str, tuple[str, str, int]] = {}
    for key, offering_id in offering_by_key.items():
        class_id, course_code, term_code = key.split(":")
        offering_meta_by_id[offering_id] = (class_id, course_code, int(term_code.replace("HK", "")))

    exact_transcript = {
        "ENG01": 9.0,
        "IT001": 9.0,
        "MA003": 5.8,
        "MA006": 7.0,
        "NT015": 9.3,
        "PH002": 8.1,
        "SS004": 8.0,
        "IT003": 9.2,
        "IT005": 8.8,
        "IT006": 7.8,
        "MA004": 9.0,
        "MA005": 8.5,
        "SS003": 6.5,
        "SS006": 7.5,
        "IT002": 6.0,
        "IT004": 8.8,
        "IT007": 7.8,
        "NT209": 7.3,
        "NT219": 8.3,
        "SS007": 7.0,
        "ENG02": 10.0,
        "ENG03": 10.0,
    }
    course_by_code = {course.code: course for course in COURSES}

    for student in students:
        student_id = student_id_by_mssv[student.mssv]
        student_by_id[student_id] = student
        available_terms = completed_terms_for_cohort(student.cohort)
        major_elective_pool = ATTT_MAJOR_ELECTIVES if student.program == "ATTT" else MMT_MAJOR_ELECTIVES
        selected_major_codes = selected_major_elective_codes(student)
        program_courses = [
            course
            for course in COURSES
            if student.program in course.programs
            and (course.code not in major_elective_pool or course.code in selected_major_codes)
        ]
        program_courses_by_student_id[student_id] = sorted(
            program_courses,
            key=lambda course: (course.term, course.code),
        )

        if student.full_name == "Phan Lâm Dũng" and student.class_code == "ATTN2024":
            for course_code, score in exact_transcript.items():
                course = course_by_code.get(course_code)
                if not course:
                    continue
                offering_term = 4 if course_code in {"ENG02", "ENG03"} else course.term
                offering_id = offering_by_key.get(f"{student.class_id}:{course_code}:HK{offering_term}")
                if not offering_id:
                    continue
                exempt = course_code in {"ENG02", "ENG03"}
                rows.append((student_id, offering_id, 1, None if exempt else score, score, "MIEN" if exempt else grade(score), True, False))
            continue

        fast_track = student.academic_status == "graduated" and student.cohort == 2022
        max_course_term = 8 if student.academic_status == "graduated" else min(available_terms, 8)

        for course in program_courses:
            if course.term > max_course_term and not fast_track:
                continue
            skipped_by_plan = should_skip(student, course, max_course_term)
            if skipped_by_plan and not (student.cohort == 2021 and student.academic_status != "graduated"):
                continue

            if fast_track and course.term == 8:
                planned_term = 7
            elif student.cohort == 2021 and student.academic_status != "graduated":
                if course.code == "GRD401":
                    planned_term = delayed_planned_term(student, course)
                elif course.code in {"PRJ401", "INT401"}:
                    planned_term = delayed_planned_term(student, course)
                elif skipped_by_plan:
                    planned_term = delayed_planned_term(student, course)
                elif course.term >= 7 and hash_string(f"{student.mssv}-{course.code}-senior-delay") % 100 < 42:
                    planned_term = delayed_planned_term(student, course)
                else:
                    planned_term = min(course.term, available_terms)
            else:
                planned_term = min(course.term, available_terms)

            offering_id = offering_by_key.get(f"{student.class_id}:{course.code}:HK{planned_term}")
            if not offering_id:
                continue

            if should_fail(student, course):
                fail_score = round(2.8 + (hash_string(f"{student.mssv}-{course.code}-bad") % 20) / 10, 1)
                rows.append((student_id, offering_id, 1, fail_score, fail_score, "F", False, False))
                can_retake = planned_term + 1 <= available_terms and hash_string(f"{student.mssv}-{course.code}-retake") % 100 < 82
                if can_retake:
                    retake_offering = offering_by_key.get(f"{student.class_id}:{course.code}:HK{min(planned_term + 1, available_terms)}")
                    if retake_offering:
                        retake_score = round(clamp(score_for(student, course, 2), 5.0, 8.8), 1)
                        rows.append((student_id, retake_offering, 2, retake_score, retake_score, grade(retake_score), True, True))
                continue

            score = max(5.0, score_for(student, course, 1))
            rows.append((student_id, offering_id, 1, score, score, grade(score), score >= 5, False))

    used_offerings_by_student: dict[str, set[str]] = {}
    passed_codes_by_student: dict[str, set[str]] = {}
    attempts_by_student_course: dict[tuple[str, str], int] = {}
    completed_credits_by_student: dict[str, int] = {}
    latest_term_by_student: dict[str, int] = {}

    for row in rows:
        student_id, offering_id, attempt_no, _, _, _, passed, _ = row
        _, course_code, term_index = offering_meta_by_id[offering_id]
        course = course_by_code[course_code]
        used_offerings_by_student.setdefault(student_id, set()).add(offering_id)
        latest_term_by_student[student_id] = max(
            latest_term_by_student.get(student_id, 0),
            term_index,
        )
        attempts_by_student_course[(student_id, course_code)] = max(
            attempts_by_student_course.get((student_id, course_code), 0),
            int(attempt_no),
        )
        if passed and course_code not in passed_codes_by_student.setdefault(student_id, set()):
            passed_codes_by_student[student_id].add(course_code)
            completed_credits_by_student[student_id] = (
                completed_credits_by_student.get(student_id, 0) + course.credits
            )

    for student_id, student in student_by_id.items():
        if student.cohort != 2021:
            continue
        if latest_term_by_student.get(student_id, 0) != 9:
            continue

        required_credits = program_required_credits(student.program)
        completed_credits = completed_credits_by_student.get(student_id, 0)
        if completed_credits >= required_credits:
            continue

        passed_codes = passed_codes_by_student.setdefault(student_id, set())
        used_offerings = used_offerings_by_student.setdefault(student_id, set())
        for course in program_courses_by_student_id[student_id]:
            if completed_credits >= required_credits:
                break
            if course.code in passed_codes:
                continue
            offering_id = offering_by_key.get(f"{student.class_id}:{course.code}:HK10")
            if not offering_id or offering_id in used_offerings:
                continue
            attempt_no = attempts_by_student_course.get((student_id, course.code), 0) + 1
            score = round(clamp(score_for(student, course, attempt_no), 5.0, 8.8), 1)
            rows.append((student_id, offering_id, attempt_no, score, score, grade(score), True, attempt_no > 1))
            used_offerings.add(offering_id)
            passed_codes.add(course.code)
            completed_credits += course.credits

    return rows


def main() -> None:
    logger.info("Starting UIT seed data initialization")
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("BEGIN")
            try:
                cur.execute(
                    """
                    TRUNCATE TABLE
                      audit_logs,
                      advisory_notes,
                      ai_briefs,
                      risk_snapshots,
                      alerts,
                      enrollments,
                      course_offerings,
                      courses,
                      students,
                      classes,
                      terms,
                      import_jobs,
                      users
                    RESTART IDENTITY CASCADE;
                    """
                )

                admin_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode("utf-8")
                advisor_hash = bcrypt.hashpw(b"advisor123", bcrypt.gensalt()).decode("utf-8")
                lecturer_hash = bcrypt.hashpw(b"lecturer123", bcrypt.gensalt()).decode("utf-8")

                cur.execute(
                    """
                    INSERT INTO users (username, password_hash, role, full_name, email)
                    VALUES ('dean_admin', %s, 'DEAN_ADMIN', 'Quản trị khoa', 'dean@cvht.local')
                    RETURNING id
                    """,
                    (admin_hash,),
                )
                dean_id = cur.fetchone()["id"]

                advisor_ids: list[str] = []
                for index in range(1, 13):
                    cur.execute(
                        """
                        INSERT INTO users (username, password_hash, role, full_name, email)
                        VALUES (%s, %s, 'ADVISOR', %s, %s)
                        RETURNING id
                        """,
                        (f"advisor_{index}", advisor_hash, f"Cố vấn {index}", f"advisor{index}@cvht.local"),
                    )
                    advisor_ids.append(cur.fetchone()["id"])

                cur.execute(
                    """
                    INSERT INTO users (username, password_hash, role, full_name, email)
                    VALUES ('lecturer_demo', %s, 'LECTURER', 'Giảng viên Demo DAA', 'lecturer@daa.local')
                    RETURNING id
                    """,
                    (lecturer_hash,),
                )
                lecturer_id = cur.fetchone()["id"]

                execute_values(
                    cur,
                    "INSERT INTO terms (term_code, term_name, start_date, end_date) VALUES %s",
                    [(term["code"], term["name"], term["start"], term["end"]) for term in TERMS],
                )

                execute_values(
                    cur,
                    "INSERT INTO courses (course_code, course_name, credits) VALUES %s",
                    [(course.code, course.name, course.credits) for course in COURSES],
                )

                class_seeds = build_classes(len(advisor_ids))
                execute_values(
                    cur,
                    "INSERT INTO classes (class_code, class_name, advisor_user_id, required_credits) VALUES %s",
                    [(row.code, row.name, advisor_ids[row.advisor_index], row.required_credits) for row in class_seeds],
                    page_size=500,
                )
                cur.execute("SELECT id, class_code FROM classes")
                class_id_by_code = {row["class_code"]: str(row["id"]) for row in cur.fetchall()}

                students = build_students(class_seeds, class_id_by_code)
                execute_values(
                    cur,
                    """
                    INSERT INTO students (
                      mssv, full_name, class_id, current_gpa, english_level,
                      cohort_year, program_code, training_system, academic_status
                    ) VALUES %s
                    """,
                    [
                        (
                            student.mssv,
                            student.full_name,
                            student.class_id,
                            0,
                            student.english_level,
                            student.cohort,
                            student.program,
                            student.training,
                            student.academic_status,
                        )
                        for student in students
                    ],
                    page_size=1000,
                )
                cur.execute("SELECT id, mssv FROM students")
                student_id_by_mssv = {row["mssv"]: str(row["id"]) for row in cur.fetchall()}

                offering_rows: list[tuple[str, str, str, str, str | None]] = []
                for class_seed in class_seeds:
                    class_id = class_id_by_code[class_seed.code]
                    for course in COURSES:
                        if class_seed.program not in course.programs:
                            continue
                        for term in TERMS:
                            demo_lecturer = (
                                str(lecturer_id)
                                if class_seed.code in {"ATTN2024", "ATTT2024.1", "MMT&TT2024.1"}
                                and course.term in {3, 4, 5, 6}
                                else None
                            )
                            lecturer_name = "Giảng viên Demo DAA" if demo_lecturer else f"GV {course.code}"
                            offering_rows.append((course.code, class_id, term["code"], lecturer_name, demo_lecturer))
                execute_values(
                    cur,
                    """
                    INSERT INTO course_offerings (course_id, class_id, term_id, lecturer_name, lecturer_user_id)
                    SELECT c.id, x.class_id::uuid, t.id, x.lecturer_name, x.lecturer_user_id::uuid
                    FROM (VALUES %s) AS x(course_code, class_id, term_code, lecturer_name, lecturer_user_id)
                    JOIN courses c ON c.course_code = x.course_code
                    JOIN terms t ON t.term_code = x.term_code
                    """,
                    offering_rows,
                    page_size=1000,
                )
                cur.execute(
                    """
                    SELECT co.id, co.class_id, c.course_code, t.term_code
                    FROM course_offerings co
                    JOIN courses c ON c.id = co.course_id
                    JOIN terms t ON t.id = co.term_id
                    """
                )
                offering_by_key = {
                    f"{row['class_id']}:{row['course_code']}:{row['term_code']}": str(row["id"])
                    for row in cur.fetchall()
                }

                enrollment_rows = build_enrollment_rows(students, student_id_by_mssv, offering_by_key)
                enrollment_insert_rows = []
                for row in enrollment_rows:
                    student_id, offering_id, attempt_no, midterm_score, final_score, letter_grade, passed, is_retake = row
                    if final_score is None:
                        process_score = None
                        practical_score = None
                        overall_score = None
                    else:
                        final_float = float(final_score)
                        process_score = round(clamp(final_float + 0.3, 0, 10), 1)
                        practical_score = round(clamp(final_float - 0.1, 0, 10), 1)
                        overall_score = round(final_float, 1)
                    enrollment_insert_rows.append(
                        (
                            student_id,
                            offering_id,
                            attempt_no,
                            process_score,
                            midterm_score,
                            practical_score,
                            final_score,
                            overall_score,
                            letter_grade,
                            passed,
                            is_retake,
                        )
                    )
                execute_values(
                    cur,
                    """
                    INSERT INTO enrollments (
                      student_id, course_offering_id, attempt_no, process_score, midterm_score,
                      practical_score, final_score, overall_score, letter_grade, passed, is_retake,
                      synced_at, source_system
                    ) VALUES %s
                    """,
                    enrollment_insert_rows,
                    page_size=1000,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 'seed')",
                )

                cur.execute(
                    """
                    WITH latest_attempt AS (
                      SELECT DISTINCT ON (e.student_id, c.course_code)
                        e.student_id,
                        c.course_code,
                        e.final_score,
                        e.letter_grade
                      FROM enrollments e
                      JOIN course_offerings co ON co.id = e.course_offering_id
                      JOIN courses c ON c.id = co.course_id
                      JOIN terms t ON t.id = co.term_id
                      WHERE UPPER(e.letter_grade) NOT IN ('MIEN', 'MIỄN', 'EXEMPT')
                      ORDER BY e.student_id, c.course_code, t.start_date DESC, e.attempt_no DESC
                    ),
                    avg_scores AS (
                      SELECT student_id, ROUND(AVG(final_score)::numeric, 2) AS avg_score
                      FROM latest_attempt
                      GROUP BY student_id
                    )
                    UPDATE students s
                    SET current_gpa = COALESCE(a.avg_score, 0)
                    FROM avg_scores a
                    WHERE a.student_id = s.id
                    """
                )
                cur.execute(
                    "UPDATE students SET current_gpa = 7.97 WHERE full_name = 'Phan Lâm Dũng' AND cohort_year = 2024"
                )

                cur.execute(
                    """
                    WITH course_state AS (
                      SELECT
                        s.id AS student_id,
                        c.course_code,
                        c.credits,
                        BOOL_OR(e.passed) AS has_passed
                      FROM students s
                      JOIN enrollments e ON e.student_id = s.id
                      JOIN course_offerings co ON co.id = e.course_offering_id
                      JOIN courses c ON c.id = co.course_id
                      GROUP BY s.id, c.course_code, c.credits
                    ),
                    credit_state AS (
                      SELECT
                        s.id AS student_id,
                        cl.required_credits,
                        COALESCE(SUM(CASE WHEN cs.has_passed THEN cs.credits ELSE 0 END), 0) AS completed_credits
                      FROM students s
                      JOIN classes cl ON cl.id = s.class_id
                      LEFT JOIN course_state cs ON cs.student_id = s.id
                      GROUP BY s.id, cl.required_credits
                    )
                    UPDATE students s
                    SET academic_status = CASE
                      WHEN cs.completed_credits >= cs.required_credits THEN 'graduated'
                      WHEN s.academic_status = 'graduated' THEN 'studying'
                      ELSE s.academic_status
                    END
                    FROM credit_state cs
                    WHERE cs.student_id = s.id
                    """
                )

                cur.execute(
                    """
                    WITH course_state AS (
                      SELECT
                        s.id AS student_id,
                        c.course_code,
                        c.credits,
                        BOOL_OR(e.passed) AS has_passed,
                        BOOL_OR(e.passed = false OR e.final_score < 5) AS has_failed,
                        MIN(e.final_score) AS min_score
                      FROM students s
                      JOIN enrollments e ON e.student_id = s.id
                      JOIN course_offerings co ON co.id = e.course_offering_id
                      JOIN courses c ON c.id = co.course_id
                      GROUP BY s.id, c.course_code, c.credits
                    )
                    SELECT
                      s.id AS student_id,
                      s.mssv,
                      s.current_gpa::float AS current_gpa,
                      cl.required_credits,
                      COALESCE(SUM(CASE WHEN cs.has_passed THEN cs.credits ELSE 0 END), 0)::float AS completed_credits,
                      COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN cs.credits ELSE 0 END), 0)::float AS debt_credits,
                      COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN 1 ELSE 0 END), 0)::int AS failed_courses,
                      COALESCE(SUM(CASE WHEN cs.min_score < 5 THEN 1 ELSE 0 END), 0)::int AS low_score_courses,
                      s.academic_status
                    FROM students s
                    JOIN classes cl ON cl.id = s.class_id
                    LEFT JOIN course_state cs ON cs.student_id = s.id
                    GROUP BY s.id, s.mssv, s.current_gpa, cl.required_credits, s.academic_status
                    """
                )
                risk_rows = cur.fetchall()
                risk_insert_rows: list[tuple[Any, ...]] = []
                alert_rows: list[tuple[Any, ...]] = []
                for row in risk_rows:
                    gpa = float(row["current_gpa"] or 0)
                    completed = float(row["completed_credits"] or 0)
                    required = float(row["required_credits"] or 0)
                    debt = float(row["debt_credits"] or 0)
                    failed = int(row["failed_courses"] or 0)
                    low = int(row["low_score_courses"] or 0)
                    completion_percent = (completed / required) * 100 if required else 0
                    score = 3 if row["academic_status"] == "graduated" else 10
                    score += max(0, 5.5 - gpa) * 12
                    score += max(0, 70 - completion_percent) * 0.45
                    score += debt * 0.9 + failed * 3.5 + low * 1.6
                    score = round(clamp(score, 1, 98), 1)
                    band = risk_band(score)
                    quadrant = risk_quadrant(completion_percent, gpa)
                    recommendation = (
                        "Đã tốt nghiệp, lưu hồ sơ theo dõi cựu sinh viên"
                        if row["academic_status"] == "graduated"
                        else "Hẹn gặp trong 7 ngày, lập kế hoạch trả nợ môn và theo dõi hằng tuần"
                        if band == "critical"
                        else "Hẹn gặp trong 14 ngày, ưu tiên môn rớt và bổ sung kế hoạch đăng ký"
                        if band == "high"
                        else "Theo dõi định kỳ mỗi 3 tuần, ưu tiên các môn nền tảng"
                        if band == "medium"
                        else "Duy trì ổn định và theo dõi học tập định kỳ"
                    )
                    risk_insert_rows.append((row["student_id"], score, band, quadrant, recommendation, "SEED"))
                    if row["academic_status"] != "graduated" and band in {"high", "critical"}:
                        alert_rows.append((row["student_id"], "DELAY_RISK", "critical" if band == "critical" else "high", f"Sinh viên {row['mssv']} có nguy cơ chậm tiến độ", "SEED"))

                execute_values(
                    cur,
                    """
                    INSERT INTO risk_snapshots (
                      student_id, delay_risk_score, risk_band, quadrant, recommended_action, generated_by
                    ) VALUES %s
                    """,
                    risk_insert_rows,
                    page_size=1000,
                )
                if alert_rows:
                    execute_values(
                        cur,
                        "INSERT INTO alerts (student_id, alert_type, severity, message, source) VALUES %s",
                        alert_rows,
                        page_size=1000,
                    )

                cur.execute(
                    """
                    SELECT
                      c.id AS class_id,
                      c.class_code,
                      SUM(CASE WHEN rs.risk_band IN ('high', 'critical') THEN 1 ELSE 0 END)::int AS high_risk_count,
                      ROUND(AVG(s.current_gpa)::numeric, 2)::text AS avg_score
                    FROM classes c
                    JOIN students s ON s.class_id = c.id
                    LEFT JOIN risk_snapshots rs ON rs.student_id = s.id
                    GROUP BY c.id, c.class_code
                    """
                )
                brief_rows = []
                for row in cur.fetchall():
                    high_risk = int(row["high_risk_count"] or 0)
                    priority = "critical" if high_risk >= 18 else "high" if high_risk >= 8 else "normal"
                    brief_rows.append(
                        (
                            row["class_id"],
                            f"Bản tin lớp {row['class_code']}",
                            f"Lớp {row['class_code']} có {high_risk} sinh viên rủi ro cao/nguy cấp, GPA trung bình {row['avg_score']}",
                            priority,
                        )
                    )
                execute_values(
                    cur,
                    "INSERT INTO ai_briefs (class_id, title, summary, priority) VALUES %s",
                    brief_rows,
                    page_size=500,
                )

                cur.execute(
                    """
                    INSERT INTO advisory_notes (student_id, advisor_user_id, note)
                    SELECT s.id, c.advisor_user_id, 'Theo dõi tiến độ học tập và ưu tiên môn nền tảng trong 2 tuần tới'
                    FROM students s
                    JOIN classes c ON c.id = s.class_id
                    WHERE s.academic_status <> 'graduated'
                    ORDER BY s.mssv
                    LIMIT 80
                    """
                )

                cur.execute("COMMIT")
                logger.info("Seed data completed", extra={"dean_user_id": dean_id, "students": len(students)})
            except Exception:
                cur.execute("ROLLBACK")
                logger.exception("Seed failed")
                raise


if __name__ == "__main__":
    main()
