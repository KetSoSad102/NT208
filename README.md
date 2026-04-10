# CVHT - Co van hoc tap thong minh

He thong theo doi hoc tap va canh bao hoc vu, gom dashboard cho co van hoc tap, API bao mat bang JWT/RBAC, worker ingestion du lieu hoc tap, va bo AI Assistant cho chat-to-data, anomaly detection, predictive analytics.

## 1) Kien truc hien tai
- Monorepo:
  - apps/api-python: backend FastAPI (Python) + JWT + RBAC + object-level authorization + audit log
  - apps/worker: ingestion pipeline (TypeScript) idempotent + retry + scheduler + job tracking
  - apps/web: dashboard React (TypeScript)
  - packages/shared: constants/types dung chung cho app TypeScript
  - infra/migrations: SQL schema
- Docker Compose services:
  - postgres, api, worker, web
  - redis la service tuy chon, bat qua profile `cache` khi can

Luu y: backend TypeScript cu o apps/api duoc giu lai de tham khao, nhung service api trong docker-compose da chuyen sang backend Python.

## 2) Cong nghe chinh
- API: FastAPI + psycopg2 + PyJWT + bcrypt
- AI orchestration: LangChain + OpenAI/Gemini provider adapter + fallback direct API call
- Worker/Web: Node.js + TypeScript
- Database: PostgreSQL
- Cache/message helper: Redis

## 3) Schema database toi gian hoa
- `users`: dang nhap + vai tro + thong tin co van/quan tri
- `classes`: lop hoc, CVHT phu trach, tong so tin chi muc tieu
- `students`: sinh vien thuoc lop, GPA hien tai, trinh do tieng Anh
- `terms`: hoc ky
- `courses`: danh muc mon hoc
- `course_offerings`: mon hoc mo theo lop va hoc ky
- `enrollments`: dang ky hoc + diem giua ky/cuoi ky + ket qua dat/rot
- `alerts`: canh bao hoc vu do rule/AI sinh ra
- `advisory_notes`: ghi chu can thiep cua CVHT
- `risk_snapshots`: anh chup diem rui ro de worker cap nhat dinh ky
- `ai_briefs`: brief tong hop theo lop
- `import_jobs`: hang doi ingestion
- `audit_logs`: nhat ky hanh dong nhay cam

Thiet ke nay bo cac bang trung gian khong can thiet cho do an nhu `advisors`, `advisor_assignments`, `final_results`, `assessment_scores`, `assessment_components`, `curriculum_plan`, `raw_import_snapshots`.

## 4) Gia dinh du lieu va tai khoan mau
- DAA duoc mock bang JSON fixture: apps/worker/src/fixtures/mock-daa.json
- Tai khoan test trong bang users:
  - dean_admin / admin123
  - advisor_1 / advisor123
- Moi lop hien dat `required_credits = 36`

## 5) Chay nhanh bang Docker (khuyen nghi)
Chay toan bo he thong:

```bash
docker compose up --build
```

Neu truoc do ban da tung chay schema cu, hay reset volume Postgres truoc:

```bash
docker compose down -v
docker compose up --build
```

Neu can bat them Redis:

```bash
docker compose --profile cache up --build
```

Endpoints sau khi chay:
- API health: http://localhost:3000/health
- Web: http://localhost:5173

Neu can bat AI planner/summarizer bang API key rieng, them vao `.env`:

```env
LLM_PROVIDER=openai
LLM_API_KEY=your_api_key
LLM_MODEL=gpt-4o-mini
# Hoac neu dung Gemini:
# LLM_PROVIDER=gemini
# LLM_MODEL=gemini-1.5-flash
```

## 6) Chay local khong Docker
Ban can chay rieng tung thanh phan.

### 6.1 Khoi dong PostgreSQL + Redis
Co the dung Docker chi cho ha tang:

```bash
docker compose up -d postgres
```

Neu can Redis:

```bash
docker compose --profile cache up -d postgres redis
```

### 6.2 API Python
Tao va kich hoat virtualenv, cai package:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r apps/api-python/requirements.txt
```

Set bien moi truong toi thieu:
- DATABASE_URL
- JWT_SECRET
- JWT_EXPIRES_IN
- LLM_PROVIDER
- LLM_API_KEY
- LLM_MODEL

Chay migration + seed:

```bash
python apps/api-python/scripts/migrate.py
python apps/api-python/scripts/seed.py
```

Start API:

```bash
cd apps/api-python
uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
```

### 6.3 Worker + Web
Cai dependencies Node o root:

```bash
npm install
```

Chay worker va web:

```bash
npm run dev:worker
npm run dev:web
```

## 7) API endpoints chinh
- Auth
  - POST /auth/login
- Classes
  - GET /classes
  - GET /classes/:id/students
- Students
  - GET /students/:mssv/dashboard
  - GET /students/:mssv/alerts
  - POST /students/:mssv/notes
- Analytics
  - GET /analytics/grade-distributions?courseOfferingId=...
  - GET /analytics/graduation-forecast
  - GET /analytics/class-leaderboard
- AI
  - GET /ai/overview
  - GET /ai/predictive/students
  - GET /ai/predictive/matrix
  - GET /ai/anomalies/briefs
  - GET /ai/anomalies/patterns
  - POST /ai/chat-to-data
- Admin
  - POST /admin/import-jobs/trigger
- Health
  - GET /health

## 8) Tinh nang AI moi
- Chat-to-Data / Text-to-SQL:
  - truy van bang tieng Viet
  - planner an toan: AI chon tool/query scope, server van kiem soat SQL template va authorization
  - ho tro tra bang, leaderboard, histogram diem
- AI Anomaly Detection:
  - sinh AI Brief cho tung lop
  - phat hien khuon mau rot mon tu lich su diem
  - gom nhom sinh vien sat nguong canh bao
- Predictive Analytics:
  - Delay Risk Score cho moi sinh vien
  - Student Risk Matrix 4 goc phan tu
  - de xuat hanh dong can thiep cho CVHT

## 9) Ingestion pipeline
- Interface DAAClient + MockDAAClient
- Trang thai job: queued -> running -> success/fail trong import_jobs
- Retry toi da 3 lan khi gap loi parser/upsert
- Upsert truc tiep vao `classes`, `students`, `courses`, `course_offerings`, `enrollments`
- Sau ingestion, worker cap nhat `current_gpa`, tao `alerts` GPA drop va `risk_snapshots`

## 10) Bao mat
- JWT auth voi Authorization: Bearer token
- RBAC roles: DEAN_ADMIN, ADVISOR
- Object-level authorization:
  - ADVISOR chi truy cap lop duoc gan va sinh vien thuoc lop do
- Audit log:
  - VIEW_DASHBOARD
  - CREATE_NOTE
  - AI_CHAT_QUERY

## 11) Test va lint
Lenh chung cho workspace TypeScript:

```bash
npm run test
npm run lint
```

Kiem tra syntax nhanh cho API Python:

```bash
python -m compileall apps/api-python
```

## 12) Security checklist
- [x] JWT + RBAC
- [x] Object-level authorization (chong BOLA)
- [x] Audit log su kien nhay cam
- [x] Input validation
- [x] Error handling
- [x] Ingestion tach rieng khoi request/response
- [x] Ingestion idempotent + retry + job status
- [x] AI/Text-to-SQL guardrails qua whitelisted planner va role-based scope
