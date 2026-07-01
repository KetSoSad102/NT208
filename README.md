# CVHT - Cố vấn học tập thông minh

Hệ thống theo dõi học tập và cảnh báo học vụ, gồm dashboard cho cố vấn học tập, API bảo mật bằng JWT/RBAC, worker ingestion dữ liệu học tập, và bộ AI Assistant cho chat-to-data, anomaly detection, predictive analytics.

---

## Bảng phân công công việc và tỉ lệ đóng góp

| STT | Họ và tên | MSSV | Công việc thực hiện | Tỉ lệ |
|:---:|-----------|:----:|---------------------|:----:|
| 1 | *Lê Trí Đức* | *24520009* | Phân tích yêu cầu hệ thống | 5% |
| 2 | *Lê Trí Đức* | *24520009* | Thiết kế cơ sở dữ liệu | 5% |
| 3 | *Lê Trí Đức* | *24520009* | Thiết kế kiến trúc backend | 5% |
| 4 | *Lê Trí Đức* | *24520009* | Xây dựng API quản lý người dùng | 10% |
| 5 | *Lê Trí Đức* | *24520009* | Xây dựng API xử lý nghiệp vụ | 10% |
| 6 | *Lê Trí Đức* | *24520009* | Tích hợp xác thực và phân quyền | 5% |
| 7 | *Lê Trí Đức* | *24520009* | Kiểm thử backend và sửa lỗi | 10% |
| 8 | *Phan Lâm Dũng* | *24520349* | Thiết kế giao diện tổng thể | 10% |
| 9 | *Phan Lâm Dũng* | *24520349* | Xây dựng giao diện đăng nhập và đăng ký | 5% |
| 10 | *Phan Lâm Dũng* | *24520349* | Xây dựng giao diện các chức năng chính | 10% |
| 11 | *Phan Lâm Dũng* | *24520349* | Kết nối frontend với backend thông qua API | 10% |
| 12 | *Phan Lâm Dũng* | *24520349* | Tối ưu giao diện và trải nghiệm người dùng | 5% |
| 13 | *Phan Lâm Dũng* | *24520349* | Kiểm thử frontend và sửa lỗi | 5% |
| 14 | *Phan Lâm Dũng* | *24520349* | Viết báo cáo và hoàn thiện tài liệu | 5% |
| **Tổng cộng** | | | | **100%** |

---

## 1) Kiến trúc hiện tại
- **Monorepo:**
  - `apps/api-python`: Backend FastAPI (Python) + JWT + RBAC + object-level authorization + audit log.
  - `apps/worker`: Ingestion pipeline (TypeScript) idempotent + retry + scheduler + job tracking.
  - `apps/web`: Dashboard React (TypeScript).
  - `packages/shared`: Thư viện constants/types dùng chung cho ứng dụng TypeScript.
  - `infra/migrations`: SQL schema cho cơ sở dữ liệu.
- **Các service Docker Compose:**
  - `postgres`, `api`, `worker`, `web`.
  - `redis` là service tùy chọn, tự động kích hoạt qua profile `cache` khi cần.

*Lưu ý: Backend TypeScript cũ ở `apps/api` được giữ lại để tham khảo, dịch vụ `api` chính thức trong docker-compose đã được chuyển sang sử dụng backend Python.*

## 2) Công nghệ chính
- **API:** FastAPI + psycopg2 + PyJWT + bcrypt.
- **AI Orchestration:** LangChain + OpenAI/Gemini provider adapter + fallback direct API call.
- **Worker/Web:** Node.js + TypeScript.
- **Cơ sở dữ liệu:** PostgreSQL.
- **Cache/Message Helper:** Redis.

## 3) Schema cơ sở dữ liệu tối giản
- `users`: Đăng nhập + vai trò + thông tin cố vấn/quản trị.
- `classes`: Lớp học do CVHT phụ trách, tổng số tín chỉ mục tiêu.
- `students`: Sinh viên thuộc lớp, GPA hiện tại, trình độ tiếng Anh.
- `terms`: Học kỳ học tập.
- `courses`: Danh mục môn học.
- `course_offerings`: Môn học được mở theo lớp và học kỳ.
- `enrollments`: Đăng ký học tập + điểm quá trình/giữa kỳ/thực hành/cuối kỳ + kết quả đạt/rớt.
- `alerts`: Cảnh báo học vụ do các rule hoặc hệ thống AI sinh ra.
- `advisory_notes`: Nhật ký ghi chú can thiệp của CVHT đối với sinh viên.
- `risk_snapshots`: Ảnh chụp điểm rủi ro để worker cập nhật định kỳ.
- `ai_briefs`: Bản tin tóm tắt phân tích tự động theo từng lớp học.
- `import_jobs`: Quản lý hàng đợi ingestion đồng bộ dữ liệu điểm.
- `audit_logs`: Nhật ký ghi lại các hành động nhạy cảm phục vụ giám sát bảo mật.

*Thiết kế này lược bỏ các bảng trung gian không cần thiết cho đồ án như `advisors`, `advisor_assignments`, `final_results`, `assessment_scores`, `assessment_components`, `curriculum_plan`, `raw_import_snapshots` để tối ưu hóa hiệu năng.*

## 4) Giả định dữ liệu và tài khoản mẫu
- **DAA** là hệ thống điểm bên ngoài đóng vai trò nguồn dữ liệu để minh họa tính năng tự động fetch/sync vào hệ thống CVHT.
- DAA demo có giao diện UI riêng hoạt động trên cổng `5174` và API snapshot riêng tại `/daa-demo/api/snapshot`.
- Worker có thể hoạt động ở chế độ `MockDAAClient` qua dữ liệu mẫu tại `apps/worker/src/fixtures/mock-daa.json` hoặc kết nối `RealDAAClient` kéo điểm trực tiếp từ API của DAA demo.
- **Tài khoản thử nghiệm trong bảng users:**
  - Trưởng khoa: `dean_admin` / `admin123`
  - Cố vấn học tập: `advisor_1` / `advisor123`
  - Giảng viên: `lecturer_demo` / `lecturer123`
- Lớp học ATTT đạt mốc 129 tín chỉ, lớp MMT&TTDL đạt mốc 130 tín chỉ theo cấu hình seed hiện tại.

## 5) Chạy nhanh bằng Docker (khuyến nghị)
Để khởi động toàn bộ hệ thống:

```bash
docker compose up --build
```

Hoặc khởi chạy thông qua lệnh NPM viết sẵn từ thư mục root:

```bash
npm run local:up
```

Trong trường hợp bạn cần làm sạch cơ sở dữ liệu cũ để chạy lại từ đầu, hãy xóa volume của Postgres:

```bash
docker compose down -v
docker compose up --build
```

Hoặc:

```bash
npm run local:reset
```

Để kích hoạt thêm dịch vụ lưu trữ Redis (Cache):

```bash
docker compose --profile cache up --build
```

Các địa chỉ truy cập (Endpoints):
- **Trang Dashboard CVHT:** [http://localhost:5173](http://localhost:5173)
- **Cổng DAA Demo UI:** [http://localhost:5174](http://localhost:5174)
- **Kiểm tra sức khỏe API:** [http://localhost:3000/health](http://localhost:3000/health)

Tài khoản mẫu:
- ** dean_admin / admin123**
- ** advisor_1 / advisor123**
- ** lecturer_demo / lecturer123**

Để bật trợ lý AI Planner/Summarizer bằng API key riêng, bạn hãy cập nhật file `.env`:

```env
LLM_PROVIDER=openai
LLM_API_KEY=your_api_key
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
# Hoặc nếu sử dụng Gemini:
# LLM_PROVIDER=gemini
# LLM_MODEL=gemini-1.5-flash
# Hoặc nếu sử dụng TrollLLM (Tương thích OpenAI):
# LLM_PROVIDER=trollllm
# LLM_API_KEY=your_trollllm_key
# LLM_BASE_URL=https://chat.trollllm.xyz/v1
# LLM_MODEL=gpt-5.4
DAA_DEMO_TOKEN=demo-daa-token
DAA_SYNC_CRON=0 23 30 6,12 *
DAA_CLIENT_MODE=real
DAA_BASE_URL=http://api:3000
DAA_API_TOKEN=demo-daa-token
```

## 6) Chạy local không sử dụng Docker
Bạn cần khởi chạy riêng lẻ từng thành phần:

### 6.1 Khởi động PostgreSQL + Redis
Có thể chạy Docker chỉ dành cho hạ tầng dịch vụ:

```bash
docker compose up -d postgres
```

Nếu cần sử dụng thêm Redis:

```bash
docker compose --profile cache up -d postgres redis
```

### 6.2 Khởi chạy API Python
Tạo và kích hoạt môi trường ảo Python virtualenv, sau đó cài đặt các gói phụ thuộc:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r apps/api-python/requirements.txt
```

Cấu hình các biến môi trường cần thiết trong file `.env` local của `api-python`.

Chạy mã lệnh khởi tạo schema (migration) và nạp dữ liệu mẫu (seed):

```bash
python apps/api-python/scripts/migrate.py
python apps/api-python/scripts/seed.py
```

Khởi chạy FastAPI server:

```bash
cd apps/api-python
uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
```

### 6.3 Khởi chạy Worker + Web
Cài đặt thư viện Node.js tại thư mục gốc:

```bash
npm install
```

Khởi chạy đồng thời worker và web dashboard:

```bash
npm run dev:worker
npm run dev:web
```

Nếu muốn chạy riêng giao diện DAA demo ở cổng `5174`:

```bash
VITE_PORT=5174 VITE_DEFAULT_ROUTE=/daa-demo VITE_API_BASE_URL=http://localhost:3000 npm run dev -w apps/web
```

---

## 7) Các endpoint API chính
- **Xác thực:**
  - `POST /auth/login`
- **Lớp học:**
  - `GET /classes`
  - `GET /classes/:id/students`
- **Sinh viên:**
  - `GET /students/:mssv/dashboard`
  - `GET /students/:mssv/alerts`
  - `POST /students/:mssv/notes`
- **Phân tích dữ liệu:**
  - `GET /analytics/grade-distributions?courseOfferingId=...`
  - `GET /analytics/graduation-forecast`
  - `GET /analytics/class-leaderboard`
- **Tính năng AI:**
  - `GET /ai/overview`
  - `GET /ai/predictive/students`
  - `GET /ai/predictive/matrix`
  - `GET /ai/anomalies/briefs`
  - `GET /ai/anomalies/patterns`
  - `POST /ai/chat-to-data` (Hỗ trợ tham số `mode`: `auto` | `data` | `assistant`)
- **Quản trị (Admin):**
  - `GET /admin/import-jobs/recent`
  - `POST /admin/import-jobs/trigger`
- **Dịch vụ DAA demo:**
  - `GET /daa-demo/offerings`
  - `GET /daa-demo/offerings/:offeringId/students`
  - `GET /daa-demo/offerings/:offeringId/students/:mssv/grades`
  - `GET /daa-demo/api/snapshot`
- **Kiểm tra sức khỏe:**
  - `GET /health`

---

## 8) Tính năng AI mới
- **Chat-to-Data / Text-to-SQL:**
  - Hỗ trợ truy vấn dữ liệu bằng ngôn ngữ tự nhiên tiếng Việt.
  - Thiết kế Planner bảo mật: AI chỉ đảm nhận vai trò phân tích yêu cầu để chọn template/scope, phía máy chủ vẫn hoàn toàn kiểm soát mã SQL thực thi và phân quyền dữ liệu (chống SQL Injection).
  - Trực quan hóa dữ liệu dạng bảng xếp hạng, phổ điểm biểu đồ cột.
- **AI Anomaly Detection (Phát hiện bất thường):**
  - Tự động tóm tắt bản tin học vụ (`AI Brief`) cho từng lớp.
  - Phân tích và phát hiện khuôn mẫu rớt môn học có tính dây chuyền từ lịch sử học tập.
  - Phân nhóm sinh viên đang nằm sát ranh giới cảnh báo để can thiệp kịp thời.
- **Predictive Analytics (Phân tích dự báo):**
  - Tính toán điểm rủi ro trễ tiến độ (`Delay Risk Score`) cho từng sinh viên.
  - Phân loại học tập qua Ma trận rủi ro sinh viên (`Student Risk Matrix`) gồm 4 góc phần tư trực quan.
  - Đề xuất hành động can thiệp cá nhân hóa gửi tới Cố vấn học tập.

## 9) Ingestion pipeline và đồng bộ dữ liệu điểm DAA
- Thiết kế Module tách biệt giữa `DAAClient`, `MockDAAClient` và `RealDAAClient`.
- Cấu hình lịch chạy định kỳ đồng bộ điểm cuối kỳ thông qua biến cron `DAA_SYNC_CRON` (mặc định cấu hình `0 23 30 6,12 *` để tự động chạy vào cuối mỗi học kỳ).
- Quản lý trạng thái job đồng bộ rõ ràng trong database: `queued` -> `running` -> `success/fail`.
- Cơ chế tự động thử lại tối đa 3 lần khi gặp sự cố phân tích dữ liệu hoặc kết nối mạng.
- Cập nhật điểm đồng thời cho các cột: `process_score`, `midterm_score`, `practical_score`, `final_score`, `overall_score`, `synced_at`, `source_system`.
- Sau khi ingest thành công, Worker tự động cập nhật lại GPA học kỳ/lũy kế của sinh viên, quét sinh cảnh báo điểm sụt giảm (`GPA drop`) và tạo snapshot rủi ro mới.
- API cho phép trigger đồng bộ thủ công từ xa:

```bash
curl -X POST http://localhost:3000/admin/import-jobs/trigger \
  -H "Authorization: Bearer <dean_admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"sourceName":"daa_demo_manual"}'
```

## 10) Bảo mật
- Xác thực bằng cơ chế token JWT dạng Bearer qua Header.
- Phân quyền theo vai trò (RBAC) nghiêm ngặt: `DEAN_ADMIN`, `ADVISOR`, `LECTURER`.
- **Phân quyền ở cấp độ bản ghi (Object-level authorization - chống BOLA):**
  - Cố vấn học tập (`ADVISOR`) chỉ có quyền truy cập dữ liệu của lớp và các sinh viên do chính mình phụ trách.
  - Giảng viên (`LECTURER`) chỉ có quyền xem điểm các học phần do mình giảng dạy.
- Token kết nối DAA sử dụng Header `X-DAA-Token` bảo mật, nạp động qua biến môi trường (không mã hóa cứng chuỗi bí mật trong mã nguồn).
- Ghi nhật ký hệ thống (Audit log) chi tiết cho các hành động nhạy cảm: `VIEW_DASHBOARD`, `CREATE_NOTE`, `AI_CHAT_QUERY`.

## 11) Kiểm thử và Lint
Chạy kiểm thử và định dạng mã nguồn cho phần TypeScript:

```bash
npm run test
npm run lint
```

Kiểm tra lỗi cú pháp nhanh cho API Python:

```bash
python -m compileall apps/api-python
```

## 12) Danh sách kiểm tra bảo mật (Security Checklist)
- [x] JWT + RBAC
- [x] Phân quyền cấp độ bản ghi (chống lỗi BOLA)
- [x] Audit log cho các sự kiện nhạy cảm
- [x] Kiểm tra tính hợp lệ dữ liệu đầu vào (Input validation)
- [x] Xử lý ngoại lệ an toàn, tránh lộ thông tin lỗi hệ thống (Error handling)
- [x] Tách biệt hoàn toàn luồng Ingestion đồng bộ điểm khỏi luồng HTTP Request/Response
- [x] Ingestion idempotent + cơ chế tự động thử lại + lưu trữ trạng thái job rõ ràng
- [x] Guardrails cho AI/Text-to-SQL thông qua bộ planner cấu hình sẵn và giới hạn quyền truy cập database theo phân quyền của người dùng đăng nhập.

*Chúng em đã biết làm web và hiểu hệ thống web hoạt động như thế nào.*


Để chạy thì thêm các thông số sau vào file `.env`
```
NODE_ENV=development
API_PORT=3000
DATABASE_URL=postgresql://cvht:cvht@postgres:5432/cvht
JWT_SECRET=supersecret_supersecret
JWT_EXPIRES_IN=12h
WORKER_POLL_SECONDS=10
INGESTION_CRON=0 1 * * *
VITE_API_BASE_URL=http://localhost:3000
LLM_PROVIDER=trollllm
LLM_API_KEY= ... 
LLM_BASE_URL=https://chat.trollllm.xyz/v1
LLM_MODEL=claude-opus-4-6
```
