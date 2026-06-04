import { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch, clearToken, setToken } from './api/client';

const DEFAULT_ROUTE = import.meta.env.VITE_DEFAULT_ROUTE || '';
const DAA_WEB_URL = import.meta.env.VITE_DAA_WEB_URL || '/daa-demo';
const CVHT_WEB_URL = import.meta.env.VITE_CVHT_WEB_URL || '/dashboard';

type ClassItem = { id: string; class_code: string; class_name: string };
type Student = {
  id: string;
  mssv: string;
  full_name: string;
  current_gpa: number | string | null;
  academic_status?: string;
};

type StudentRisk = {
  id?: string;
  mssv: string;
  fullName: string;
  classCode: string;
  academicStatus?: string;
  currentGpa: number;
  completedCredits: number;
  requiredCredits: number;
  debtCredits: number;
  completionRatio: number;
  failedCourses: number;
  lowScoreCourses: number;
  delayRiskScore: number;
  riskBand: string;
  quadrant: string;
  recommendedAction: string;
};

type DashboardResponse = {
  student: { id: string; mssv: string; full_name: string; class_code: string };
  gpaTrend: Array<{ termCode: string; gpa: number }>;
  creditProgress: { completed: number; required: number; debt: number };
  alerts: Array<{ id: string; message: string; severity: string; alert_type?: string; created_at?: string }>;
  notes: Array<{ note: string; created_at: string }>;
  riskProfile?: StudentRisk;
};

type StudentProfileResponse = {
  id: string;
  mssv: string;
  full_name: string;
  current_gpa: number | string | null;
  english_level?: string | null;
  cohort_year?: number | null;
  program_code?: string | null;
  training_system?: string | null;
  academic_status?: string | null;
  class_code: string;
  class_name: string;
  required_credits: number;
};

type CreditProgressResponse = {
  completed: number;
  required: number;
  debt: number;
};

type StudentAlert = {
  id: string;
  alert_type?: string;
  severity: string;
  message: string;
  created_at?: string;
};

type StudentFeature =
  | 'overview'
  | 'profile'
  | 'gpa'
  | 'grades'
  | 'credits'
  | 'risk'
  | 'policy'
  | 'alerts'
  | 'notes';

const studentFeatureIds: StudentFeature[] = [
  'overview',
  'profile',
  'gpa',
  'grades',
  'credits',
  'risk',
  'policy',
  'alerts',
  'notes',
];

function normalizeStudentFeature(value: string | undefined): StudentFeature {
  return studentFeatureIds.includes(value as StudentFeature) ? (value as StudentFeature) : 'overview';
}

function getStudentEndpointTabs(mssv: string) {
  return [
    { id: 'overview' as const, label: 'Tổng quan', path: `/students/${mssv}/dashboard` },
    { id: 'profile' as const, label: 'Hồ sơ', path: `/students/${mssv}/profile` },
    { id: 'gpa' as const, label: 'GPA', path: `/students/${mssv}/gpa-trend` },
    { id: 'grades' as const, label: 'Điểm chi tiết', path: `/students/${mssv}/grades` },
    { id: 'credits' as const, label: 'Tín chỉ', path: `/students/${mssv}/credit-progress` },
    { id: 'risk' as const, label: 'Rủi ro', path: `/students/${mssv}/risk-profile` },
    { id: 'policy' as const, label: 'Tiến độ', path: `/students/${mssv}/academic-progress` },
    { id: 'alerts' as const, label: 'Cảnh báo', path: `/students/${mssv}/alerts` },
    { id: 'notes' as const, label: 'Nhật ký', path: `/students/${mssv}/notes` },
  ];
}

type AcademicProgressResponse = {
  identification: {
    program: string;
    programName: string;
    trainingSystem: string;
    evidence: string;
  };
  baseline: {
    totalCredits?: number;
    timelineAvailable: boolean;
    note: string;
  };
  termProgress: Array<{
    termIndex: number;
    termCode: string;
    termName: string;
    registeredCredits: number;
    passedCredits: number;
    cumulativePassedCredits: number;
    validRegistration: boolean;
    status: 'normal' | 'delayed' | 'in_progress_warning';
    reason: string;
  }>;
  failedCourses: Array<{
    termCode: string;
    courseCode: string;
    courseName: string;
    credits: number;
    finalScore: number;
    letterGrade: string;
    retaken?: boolean;
    resolved?: boolean;
    retakeTermCode?: string | null;
    retakeScore?: number | null;
  }>;
  missingCourses: {
    status: 'computed' | 'timeline_missing' | 'unknown_program';
    note: string;
    items: Array<{ code?: string; name: string; credits?: number; group: string }>;
  };
  currentRegistration: {
    termCode?: string;
    currentCredits: number;
    minimumCredits: number;
    additionalCreditsNeeded: number;
    recommendationNote: string;
    suggestedCourses: Array<{ code?: string; name: string; credits?: number; group: string }>;
  };
};

type OverviewResponse = {
  kpis: {
    students: number;
    highRisk: number;
    critical: number;
    alerts: number;
    averageRisk: number;
  };
  topRisks: StudentRisk[];
};

type GpaLineStudent = {
  mssv: string;
  fullName: string;
  classCode: string;
  currentGpa: number;
  series: Array<{ termCode: string; gpa: number | null }>;
};

type GpaLineResponse = {
  termCodes: string[];
  students: GpaLineStudent[];
  availableStudents: Array<{
    mssv: string;
    fullName: string;
    classCode: string;
    currentGpa: number;
  }>;
};

type StudentGradesResponse = {
  student: {
    id: string;
    mssv: string;
    fullName: string;
    classCode: string;
  };
  summary: {
    courseCount: number;
    registeredCredits: number;
    passedCredits: number;
    failedCount: number;
  };
  terms: Array<{
    termCode: string;
    termName: string;
    startDate: string;
    registeredCredits: number;
    passedCredits: number;
    termGpa: number;
    courses: Array<{
      courseCode: string;
      courseName: string;
      credits: number;
      attemptNo: number;
      processScore: number;
      midtermScore: number;
      practicalScore: number;
      finalScore: number;
      overallScore: number;
      letterGrade: string;
      passed: boolean;
      isRetake: boolean;
      syncedAt?: string | null;
      sourceSystem?: string | null;
    }>;
  }>;
};

type ImportJob = {
  id: string;
  sourceName: string;
  status: string;
  recordsProcessed: number;
  errorMessage?: string | null;
  createdBy: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type DAAOffering = {
  offeringId: string;
  classCode: string;
  className: string;
  termCode: string;
  termName: string;
  courseCode: string;
  courseName: string;
  credits: number;
  lecturerName: string;
  studentCount: number;
};

type DAAStudentScore = {
  mssv: string;
  fullName: string;
  classCode?: string;
  termCode?: string;
  courseCode?: string;
  courseName?: string;
  credits?: number;
  attemptNo?: number;
  processScore: number;
  midtermScore: number;
  practicalScore: number;
  finalScore: number;
  overallScore: number;
  letterGrade: string;
  passed: boolean;
  syncedAt?: string | null;
  sourceSystem?: string | null;
};

type Brief = {
  classCode: string;
  summary: string;
  priority: string;
  metrics: {
    studentCount: number;
    failedNow: number;
    borderline: number;
    averageScore: number;
    highRiskCount: number;
    topRiskStudent?: string | null;
  };
};

type Pattern = {
  antecedentCode?: string | null;
  antecedentName: string;
  consequentCode?: string | null;
  consequentName?: string | null;
  supportCount: number;
  confidence: number;
  message: string;
};

type ChatResult = {
  mode?: 'data' | 'assistant';
  message: string;
  answer: string;
  sqlPreview?: string | null;
  rows: Array<Record<string, unknown>>;
  visualization: { type: string; xKey?: string; yKey?: string };
  llmEnabled: boolean;
  provider?: string | null;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result?: ChatResult;
  timestamp: number;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

const CHAT_SESSIONS_STORAGE_KEY = 'cvht_ai_chat_sessions';
const LEGACY_CHAT_SESSIONS_STORAGE_KEY = 'ai_chat_sessions';

function makeChatSession(title = 'Cuộc trò chuyện mới'): ChatSession {
  const now = Date.now();
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getSessionTitle(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Cuộc trò chuyện mới';
  return clean.length > 46 ? `${clean.slice(0, 46)}...` : clean;
}

function loadChatSessions(): ChatSession[] {
  const fallback = [makeChatSession()];
  try {
    const stored =
      localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_CHAT_SESSIONS_STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as ChatSession[];
    const valid = Array.isArray(parsed)
      ? parsed.filter((session) => session?.id && Array.isArray(session.messages))
      : [];
    return valid.length ? valid : fallback;
  } catch {
    return fallback;
  }
}

function riskLabel(score: number): string {
  if (score >= 75) return 'Nguy cấp';
  if (score >= 55) return 'Cao';
  if (score >= 35) return 'Trung bình';
  return 'Thấp';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('vi-VN');
}

function formatSyncSource(value?: string | null): string {
  if (!value) return 'Chưa có nguồn';
  if (value.includes('seed_uit')) return 'Seed dữ liệu UIT';
  if (value.includes('daa')) return 'DAA demo';
  if (value.includes('mock')) return 'DAA mock';
  return value.replace(/_/g, ' ');
}

function formatScore(value: unknown, digits = 2, fallback = '--'): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(digits);
}

function currentRole(): string | null {
  const rawToken = localStorage.getItem('cvht_token');
  if (!rawToken) return null;
  try {
    const payload = JSON.parse(atob(rawToken.split('.')[1] ?? ''));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function inferPromptMode(message: string): 'data' | 'assistant' {
  const normalized = message.toLowerCase().trim();
  const assistantPatterns = [
    /tôi cần làm gì/u,
    /toi can lam gi/u,
    /nên làm gì/u,
    /nen lam gi/u,
    /phải làm gì/u,
    /phai lam gi/u,
    /gợi ý/u,
    /goi y/u,
    /kế hoạch/u,
    /ke hoach/u,
    /can thiệp/u,
    /can thiep/u,
    /tư vấn/u,
    /tu van/u,
    /hướng dẫn/u,
    /huong dan/u,
    /xử lý thế nào/u,
    /xu ly the nao/u,
    /mẫu tin nhắn/u,
    /mau tin nhan/u,
  ];

  return assistantPatterns.some((pattern) => pattern.test(normalized)) ? 'assistant' : 'data';
}

function LoginPage() {
  const navigate = useNavigate();
  const isDaaEntry = DEFAULT_ROUTE === '/daa-demo';
  const [username, setUsername] = useState(isDaaEntry ? 'lecturer_demo' : 'advisor_1');
  const [password, setPassword] = useState(isDaaEntry ? 'lecturer123' : 'advisor123');
  const [error, setError] = useState('');

  if (DEFAULT_ROUTE && localStorage.getItem('cvht_token')) {
    return <Navigate to={DEFAULT_ROUTE} replace />;
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="eyebrow">CVHT AI Suite</div>
        <h1>Trợ lý học vụ thông minh cho Cố vấn và Quản trị viên</h1>
        <p className="auth-copy">
          Đăng nhập để truy vấn dữ liệu bằng tiếng Việt, nhận bản tin bất thường tự động và theo dõi ma trận
          rủi ro học vụ gần như theo thời gian thực.
        </p>
        <div className="auth-grid">
          <label>
            <span>Tai khoan</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập" />
          </label>
          <label>
            <span>Mật khẩu</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mật khẩu"
              type="password"
            />
          </label>
        </div>
        <button
          className="primary-button"
          onClick={async () => {
            try {
              setError('');
              const data = await apiFetch<{ accessToken: string }>('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
              });
              setToken(data.accessToken);
              navigate(DEFAULT_ROUTE || (username === 'lecturer_demo' ? '/daa-demo' : '/dashboard'));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
            }
          }}
        >
          Đăng nhập vào bảng điều khiển AI
        </button>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="sample-logins">
          <span>`dean_admin / admin123`</span>
          <span>`advisor_1 / advisor123`</span>
          <span>`lecturer_demo / lecturer123`</span>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <p className="metric-note">{note}</p>
    </div>
  );
}

function MiniTrend({ items }: { items: Array<{ termCode: string; gpa: number }> }) {
  if (!items.length) return <p className="muted">Chưa có dữ liệu xu hướng GPA.</p>;
  const max = Math.max(...items.map((item) => item.gpa), 1);
  return (
    <div className="mini-chart">
      {items.map((item) => (
        <div className="mini-bar" key={item.termCode}>
          <div className="mini-bar-fill" style={{ height: `${(item.gpa / max) * 100}%` }} />
          <strong className="mini-bar-value">{formatScore(item.gpa, 2)}</strong>
          <span className="mini-bar-label">{item.termCode}</span>
        </div>
      ))}
    </div>
  );
}

const gpaLineColors = ['#17568d', '#e0872f', '#16805d', '#b83f43', '#7057b8', '#0f7f91', '#8a5a08', '#d95f8d', '#426b2c', '#1f76b2'];

function GpaLineChart({ data, onRemove }: { data?: GpaLineResponse; onRemove: (mssv: string) => void }) {
  const [zoom, setZoom] = useState(1);
  if (!data) return <p className="muted">Đang tải biểu đồ GPA...</p>;
  if (!data.students.length || !data.termCodes.length) {
    return <p className="muted">Chưa chọn sinh viên nào để hiển thị.</p>;
  }

  const zoomPercent = Math.round(zoom * 100);
  const width = 1120;
  const height = 420;
  const chartWidth = Math.round(width * zoom);
  const chartHeight = Math.round(height * zoom);
  const padding = { top: 28, right: 34, bottom: 52, left: 62 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const xFor = (index: number) =>
    padding.left + (data.termCodes.length === 1 ? plotWidth / 2 : (index / (data.termCodes.length - 1)) * plotWidth);
  const yFor = (gpa: number) => padding.top + ((10 - Math.max(0, Math.min(10, gpa))) / 10) * plotHeight;
  const yTicks = [10, 8, 6, 4, 2, 0];

  return (
    <div className="gpa-line-shell">
      <div className="gpa-line-toolbar">
        <div className="matrix-zoom">
          <button
            className="chip"
            type="button"
            onClick={() => setZoom((current) => Math.max(0.8, Number((current - 0.2).toFixed(1))))}
            disabled={zoom <= 0.8}
          >
            Thu nhỏ
          </button>
          <span>{zoomPercent}%</span>
          <button
            className="chip"
            type="button"
            onClick={() => setZoom((current) => Math.min(2.2, Number((current + 0.2).toFixed(1))))}
            disabled={zoom >= 2.2}
          >
            Phóng to
          </button>
          <button className="chip" type="button" onClick={() => setZoom(1)} disabled={zoom === 1}>
            Mặc định
          </button>
        </div>
      </div>
      <div className="gpa-line-plot" role="img" aria-label="Biểu đồ đường GPA theo học kỳ">
        <svg width={chartWidth} height={chartHeight}>
          {yTicks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} className="gpa-grid-line" />
                <text x={20} y={y + 5} className="gpa-axis-label">
                  {tick}
                </text>
              </g>
            );
          })}
          {data.termCodes.map((termCode, index) => {
            const x = xFor(index);
            return (
              <g key={termCode}>
                <line x1={x} x2={x} y1={padding.top} y2={chartHeight - padding.bottom} className="gpa-grid-line vertical" />
                <text x={x} y={chartHeight - 18} textAnchor="middle" className="gpa-axis-label">
                  {termCode}
                </text>
              </g>
            );
          })}
          {data.students.map((student, studentIndex) => {
            const color = gpaLineColors[studentIndex % gpaLineColors.length];
            const points = student.series
              .map((item, index) =>
                item.gpa == null ? null : { x: xFor(index), y: yFor(item.gpa), gpa: item.gpa, termCode: item.termCode },
              )
              .filter((item): item is { x: number; y: number; gpa: number; termCode: string } => item !== null);
            const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

            return (
              <g key={student.mssv}>
                <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point, index) => (
                  <g key={`${student.mssv}-${index}`}>
                    <text x={point.x} y={Math.max(14, point.y - 11)} textAnchor="middle" className="gpa-node-label-bg">
                      {point.gpa.toFixed(1)}
                    </text>
                    <text
                      x={point.x}
                      y={Math.max(14, point.y - 11)}
                      textAnchor="middle"
                      className="gpa-node-label"
                      style={{ fill: color }}
                    >
                      {point.gpa.toFixed(1)}
                    </text>
                    <circle cx={point.x} cy={point.y} r="5.5" fill={color}>
                      <title>
                        {student.fullName} • {point.termCode} • GPA {point.gpa.toFixed(2)}
                      </title>
                    </circle>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="gpa-line-legend">
        {data.students.map((student, index) => (
          <button key={student.mssv} className="gpa-legend-chip" type="button" onClick={() => onRemove(student.mssv)}>
            <span style={{ background: gpaLineColors[index % gpaLineColors.length] }} />
            {student.fullName} · {student.mssv}
            <b>×</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function BarChart({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <p className="muted">Không có dữ liệu biểu đồ.</p>;
  const max = Math.max(...rows.map((row) => Number(row.count ?? 0)), 1);
  const formatBinLabel = (value: unknown) => {
    const label = String(value ?? '');
    return label.startsWith('10-') ? '10' : label;
  };
  return (
    <div className="bar-chart">
      {rows.map((row, index) => (
        <div className="bar-row" key={`${row.bin}-${index}`}>
          <span>{formatBinLabel(row.bin)}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(Number(row.count ?? 0) / max) * 100}%` }} />
          </div>
          <strong>{String(row.count)}</strong>
        </div>
      ))}
    </div>
  );
}

const chatColumnLabels: Record<string, string> = {
  student_id: 'Mã sinh viên nội bộ',
  id: 'Mã bản ghi',
  mssv: 'MSSV',
  fullName: 'Họ tên',
  full_name: 'Họ tên',
  classCode: 'Lớp',
  class_code: 'Lớp',
  class_name: 'Tên lớp',
  currentGpa: 'GPA',
  current_gpa: 'GPA',
  completedCredits: 'Hoàn thành tín chỉ',
  requiredCredits: 'Tổng tín chỉ',
  debtCredits: 'Môn rớt chưa học lại',
  academicStatus: 'Trạng thái học tập',
  academic_status: 'Trạng thái học tập',
  completionRatio: 'Tỷ lệ hoàn thành',
  failedCourses: 'Số môn rớt',
  lowScoreCourses: 'Số môn điểm thấp',
  delayRiskScore: 'Mức rủi ro (%)',
  delay_risk_score: 'Mức rủi ro (%)',
  riskBand: 'Nhóm rủi ro',
  risk_band: 'Nhóm rủi ro',
  quadrant: 'Phân vùng',
  recommendedAction: 'Khuyến nghị',
  recommended_action: 'Khuyến nghị',
  courseName: 'Môn học',
  course_name: 'Môn học',
  averageScore: 'Điểm trung bình',
  average_score: 'Điểm trung bình',
  avg_score: 'Điểm trung bình',
  avg_gpa: 'GPA trung bình',
  student_count: 'Số sinh viên',
  total_students: 'Tổng số sinh viên',
  avg_delay_risk_score: 'Điểm rủi ro trung bình',
  high_risk_count: 'Số sinh viên rủi ro cao',
  critical_count: 'Số sinh viên nguy cấp',
  alert_count: 'Số cảnh báo',
  term_code: 'Học kỳ',
  course_code: 'Mã môn học',
  class_count: 'Số lớp',
  count: 'Số lượng',
  bin: 'Khoảng điểm',
};

const hiddenChatColumns = new Set(['student_id', 'id', 'advisor_user_id']);

function humanizeChatHeader(key: string): string {
  if (chatColumnLabels[key]) {
    return chatColumnLabels[key];
  }

  const tokenMap: Record<string, string> = {
    avg: 'Trung bình',
    average: 'Trung bình',
    count: 'Số lượng',
    total: 'Tổng',
    student: 'sinh viên',
    students: 'sinh viên',
    class: 'lớp',
    course: 'môn học',
    risk: 'rủi ro',
    delay: 'chậm tiến độ',
    score: 'điểm',
    gpa: 'GPA',
    band: 'nhóm',
    rate: 'tỷ lệ',
    code: 'mã',
    name: 'tên',
    term: 'học kỳ',
    credit: 'tín chỉ',
    credits: 'tín chỉ',
    completion: 'hoàn thành',
    action: 'khuyến nghị',
    recommendation: 'khuyến nghị',
    alert: 'cảnh báo',
    low: 'thấp',
    high: 'cao',
    critical: 'nguy cấp',
    medium: 'trung bình',
    failed: 'rớt',
  };

  const parts = key
    .split('_')
    .map((part) => tokenMap[part.toLowerCase()] ?? part)
    .filter(Boolean);

  if (!parts.length) {
    return key;
  }

  const normalized = parts.join(' ').replace(/\s+/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanizeChatCell(key: string, value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
  }
  if (typeof value === 'boolean') {
    return value ? 'Có' : 'Không';
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (key === 'risk_band' || key === 'riskBand') {
      if (normalized === 'critical') return 'Nguy cấp';
      if (normalized === 'high') return 'Cao';
      if (normalized === 'medium') return 'Trung bình';
      if (normalized === 'low') return 'Thấp';
    }
    if (key === 'academic_status' || key === 'academicStatus') {
      if (normalized === 'graduated') return 'Đã tốt nghiệp';
      if (normalized === 'delayed') return 'Chậm tiến độ';
      if (normalized === 'studying') return 'Đang học';
    }
    if (key === 'quadrant') {
      if (normalized === 'credit_low_gpa_low') return 'Tín chỉ thấp - GPA thấp';
      if (normalized === 'credit_low_gpa_ok') return 'Tín chỉ thấp - GPA tạm ổn';
      if (normalized === 'credit_ok_gpa_low') return 'Tín chỉ ổn - GPA thấp';
      if (normalized === 'safe_zone') return 'Vùng an toàn';
    }
  }
  return String(value ?? '');
}

type AnswerBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; items: string[] };

function parseAnswerBlocks(answer: string): AnswerBlock[] {
  const lines = answer.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim());
  const blocks: AnswerBlock[] = [];
  let paragraphBuffer: string[] = [];
  let bulletBuffer: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    blocks.push({ type: 'paragraph', text: paragraphBuffer.join(' ') });
    paragraphBuffer = [];
  };

  const flushBullet = () => {
    if (!bulletBuffer.length) return;
    blocks.push({ type: 'bullet', items: [...bulletBuffer] });
    bulletBuffer = [];
  };

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushBullet();
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•]|\d+[\.)])\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      bulletBuffer.push(bulletMatch[1]);
      continue;
    }

    flushBullet();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushBullet();
  return blocks.length ? blocks : [{ type: 'paragraph', text: answer }];
}

function ChatResultPanel({ result, error, isPending }: { result?: ChatResult; error?: string; isPending?: boolean }) {
  if (isPending) {
    return <p className="muted">AI đang xử lý truy vấn của bạn...</p>;
  }

  if (error) {
    return <p className="error-text">{error}</p>;
  }

  if (!result) {
    return <p className="muted">Bạn có thể hỏi dữ liệu học vụ hoặc xin tư vấn/kế hoạch can thiệp học tập.</p>;
  }

  const keys = result.rows.length > 0 ? Object.keys(result.rows[0]).filter((key) => !hiddenChatColumns.has(key)) : [];
  const answerBlocks = parseAnswerBlocks(result.answer);

  return (
    <div className="chat-result">
      <div className="assistant-answer">
        <div className="eyebrow">Phản hồi AI</div>
        <div className="assistant-answer-content">
          {answerBlocks.map((block, index) =>
            block.type === 'paragraph' ? (
              <p key={index}>{block.text}</p>
            ) : (
              <ul key={index} className="assistant-bullets">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </div>
      </div>

      {result.visualization.type === 'bar_chart' ? <BarChart rows={result.rows} /> : null}

      {result.mode === 'data' && result.rows.length === 0 ? (
        <p className="muted">
          Truy vấn đã chạy thành công nhưng hiện không có dòng dữ liệu nào khớp điều kiện lọc.
        </p>
      ) : null}

      {result.rows.length > 0 && result.visualization.type !== 'bar_chart' ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>{humanizeChatHeader(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {keys.map((key) => (
                    <td key={key}>{humanizeChatCell(key, row[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

    </div>
  );
}

function AcademicProgressPanel({ report }: { report?: AcademicProgressResponse }) {
  if (!report) {
    return <p className="muted">Đang tải báo cáo tiến độ theo policy.</p>;
  }

  const statusLabel: Record<AcademicProgressResponse['termProgress'][number]['status'], string> = {
    normal: 'Bình thường',
    delayed: 'Chậm tiến độ',
    in_progress_warning: 'Cần đăng ký thêm',
  };

  return (
    <div className="academic-policy-card">
      <div className="policy-summary">
        <div>
          <span className="metric-label">Ngành/hệ xác định</span>
          <strong>{report.identification.programName}</strong>
          <p>{report.identification.trainingSystem}</p>
        </div>
        <div>
          <span className="metric-label">Căn cứ policy</span>
          <p>{report.identification.evidence}</p>
        </div>
      </div>

      {!report.baseline.timelineAvailable ? (
        <div className="policy-alert">
          <strong>Chưa đủ baseline chương trình</strong>
          <p>{report.baseline.note}</p>
        </div>
      ) : null}

      <div className="table-shell compact">
        <table>
          <thead>
            <tr>
              <th>Học kỳ</th>
              <th>TC đăng ký</th>
              <th>TC đạt</th>
              <th>Lũy kế</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {report.termProgress.map((term) => (
              <tr key={term.termCode}>
                <td>
                  <strong>HK{term.termIndex}</strong>
                  <span>{term.termName}</span>
                </td>
                <td>{term.registeredCredits}</td>
                <td>{term.passedCredits}</td>
                <td>{term.cumulativePassedCredits}</td>
                <td>
                  <span className={`policy-status ${term.status}`}>{statusLabel[term.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="policy-grid">
        <div>
          <h4>Môn rớt</h4>
          {report.failedCourses.length ? (
            <ul className="policy-list">
              {report.failedCourses.map((course) => (
                <li key={`${course.termCode}-${course.courseCode}`}>
                  <strong>{course.courseName}</strong>
                  <span>
                    {course.credits} TC • Điểm {formatScore(course.finalScore, 1)} • {course.letterGrade}
                  </span>
                  <span
                    className={`retake-status ${
                      course.resolved ? 'resolved' : course.retaken ? 'retried' : 'missing'
                    }`}
                  >
                    {course.resolved
                      ? `Đã học lại và đạt${course.retakeTermCode ? ` ở ${course.retakeTermCode}` : ''}`
                      : course.retaken
                        ? 'Đã học lại nhưng chưa đạt'
                        : 'Chưa học lại'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Không có môn nào bị rớt.</p>
          )}
        </div>

        <div>
          <h4>HK hiện tại</h4>
          <p className="registration-callout">
            Đang ghi nhận <strong>{report.currentRegistration.currentCredits} TC</strong>. Cần thêm{' '}
            <strong>{report.currentRegistration.additionalCreditsNeeded} TC</strong> để đạt ngưỡng{' '}
            {report.currentRegistration.minimumCredits} TC.
          </p>
          <div className="suggestion-list">
            {report.currentRegistration.suggestedCourses.slice(0, 4).map((course) => (
              <span key={`${course.group}-${course.code ?? course.name}`}>
                {course.code ? `${course.code} - ` : ''}
                {course.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="policy-alert subtle">
        <strong>Môn chậm/chưa học</strong>
        <p>{report.missingCourses.note}</p>
      </div>
    </div>
  );
}

function GradeDetailPanel({ grades }: { grades?: StudentGradesResponse }) {
  if (!grades) {
    return <p className="muted">Đang tải điểm chi tiết.</p>;
  }

  return (
    <div className="grade-detail">
      <div className="endpoint-kv-grid">
        <div className="endpoint-kv-card">
          <span>Tổng học phần</span>
          <strong>{grades.summary.courseCount}</strong>
          <p>Số lượt môn đã ghi nhận trong bảng điểm</p>
        </div>
        <div className="endpoint-kv-card">
          <span>Tín chỉ đạt</span>
          <strong>
            {grades.summary.passedCredits} / {grades.summary.registeredCredits}
          </strong>
          <p>Tính cả môn miễn nếu có</p>
        </div>
        <div className="endpoint-kv-card">
          <span>Môn rớt</span>
          <strong>{grades.summary.failedCount}</strong>
          <p>Các lượt học chưa đạt</p>
        </div>
        <div className="endpoint-kv-card">
          <span>Sinh viên</span>
          <strong>{grades.student.fullName}</strong>
          <p>
            {grades.student.mssv} · {grades.student.classCode}
          </p>
        </div>
      </div>

      <div className="grade-term-stack">
        {grades.terms.map((term) => (
          <section className="grade-term-card" key={term.termCode}>
            <div className="grade-term-heading">
              <div>
                <span className="metric-label">{term.termCode}</span>
                <h3>{term.termName}</h3>
              </div>
              <div className="grade-term-stats">
                <span>GPA kỳ {formatScore(term.termGpa, 2)}</span>
                <span>
                  Đạt {term.passedCredits}/{term.registeredCredits} TC
                </span>
              </div>
            </div>
            <div className="table-shell compact grade-table">
              <table>
                <thead>
                  <tr>
                    <th>Mã môn</th>
                    <th>Học phần</th>
                    <th>TC</th>
                    <th>Lần</th>
                    <th>Quá trình</th>
                    <th>Giữa kỳ</th>
                    <th>Thực hành</th>
                    <th>Cuối kỳ</th>
                    <th>Tổng kết</th>
                    <th>Chữ</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {term.courses.map((course) => (
                    <tr key={`${term.termCode}-${course.courseCode}-${course.attemptNo}`}>
                      <td>{course.courseCode}</td>
                      <td>
                        <strong>{course.courseName}</strong>
                        {course.isRetake ? <span>Học lại</span> : null}
                      </td>
                      <td>{course.credits}</td>
                      <td>{course.attemptNo}</td>
                      <td>{formatScore(course.processScore, 1)}</td>
                      <td>{formatScore(course.midtermScore, 1)}</td>
                      <td>{formatScore(course.practicalScore, 1)}</td>
                      <td>{formatScore(course.finalScore, 1)}</td>
                      <td>{formatScore(course.overallScore, 1)}</td>
                      <td>{course.letterGrade}</td>
                      <td>
                        <span className={`policy-status ${course.passed ? 'normal' : 'delayed'}`}>
                          {course.passed ? 'Đạt' : 'Rớt'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DashboardPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const navigate = useNavigate();
  const role = currentRole();

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedClassCode, setSelectedClassCode] = useState('');
  const [selectedMssv, setSelectedMssv] = useState('');
  const [selectedGpaMssvs, setSelectedGpaMssvs] = useState<string[]>([]);
  const [gpaSelectionReady, setGpaSelectionReady] = useState(false);
  const [gpaCandidate, setGpaCandidate] = useState('');

  const classes = useQuery({
    queryKey: ['classes'],
    queryFn: () => apiFetch<ClassItem[]>('/classes'),
    enabled: hasToken,
  });
  const overview = useQuery({
    queryKey: ['ai-overview'],
    queryFn: () => apiFetch<OverviewResponse>('/ai/overview'),
    enabled: hasToken,
  });
  const briefs = useQuery({
    queryKey: ['ai-briefs'],
    queryFn: () => apiFetch<Brief[]>('/ai/anomalies/briefs'),
    enabled: hasToken,
  });
  const patterns = useQuery({
    queryKey: ['ai-patterns'],
    queryFn: () => apiFetch<Pattern[]>('/ai/anomalies/patterns'),
    enabled: hasToken,
  });
  const importJobs = useQuery({
    queryKey: ['import-jobs-recent'],
    queryFn: () => apiFetch<ImportJob[]>('/admin/import-jobs/recent'),
    enabled: hasToken,
  });
  const triggerImport = useMutation({
    mutationFn: () =>
      apiFetch<ImportJob>('/admin/import-jobs/trigger', {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'daa_demo_manual' }),
      }),
    onSuccess: async () => {
      await importJobs.refetch();
      window.setTimeout(() => void importJobs.refetch(), 2500);
      window.setTimeout(() => void importJobs.refetch(), 8000);
    },
  });

  const students = useQuery({
    queryKey: ['students', selectedClassId],
    queryFn: () => apiFetch<Student[]>(`/classes/${selectedClassId}/students`),
    enabled: hasToken && !!selectedClassId,
  });

  const dashboard = useQuery({
    queryKey: ['dashboard', selectedMssv],
    queryFn: () => apiFetch<DashboardResponse>(`/students/${selectedMssv}/dashboard`),
    enabled: hasToken && !!selectedMssv,
  });

  const riskStudents = useQuery({
    queryKey: ['risk-students', selectedClassCode],
    queryFn: () =>
      apiFetch<StudentRisk[]>(
        `/ai/predictive/students${selectedClassCode ? `?classCode=${encodeURIComponent(selectedClassCode)}` : ''}`,
      ),
    enabled: hasToken,
  });

  const gpaLines = useQuery({
    queryKey: ['gpa-lines', selectedClassCode, selectedGpaMssvs.join(',')],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedClassCode) params.set('classCode', selectedClassCode);
      if (selectedGpaMssvs.length) params.set('mssv', selectedGpaMssvs.join(','));
      return apiFetch<GpaLineResponse>(`/ai/predictive/gpa-lines?${params.toString()}`);
    },
    enabled: hasToken,
  });

  useEffect(() => {
    if (!classes.data?.length || selectedClassId) return;
    const firstClass = classes.data[0];
    setSelectedClassId(firstClass.id);
    setSelectedClassCode(firstClass.class_code);
  }, [classes.data, selectedClassId]);

  useEffect(() => {
    if (!students.data?.length) return;
    const stillExists = students.data.some((student) => student.mssv === selectedMssv);
    if (!selectedMssv || !stillExists) {
      setSelectedMssv(students.data[0].mssv);
    }
  }, [students.data, selectedMssv]);

  const activeClassName = classes.data?.find((item) => item.id === selectedClassId)?.class_name;
  const pageError =
    (classes.error instanceof Error && classes.error.message) ||
    (overview.error instanceof Error && overview.error.message) ||
    (students.error instanceof Error && students.error.message) ||
    (dashboard.error instanceof Error && dashboard.error.message) ||
    (riskStudents.error instanceof Error && riskStudents.error.message) ||
    (gpaLines.error instanceof Error && gpaLines.error.message) ||
    (importJobs.error instanceof Error && importJobs.error.message) ||
    (triggerImport.error instanceof Error && triggerImport.error.message);

  useEffect(() => {
    setSelectedGpaMssvs([]);
    setGpaSelectionReady(false);
    setGpaCandidate('');
  }, [selectedClassCode]);

  useEffect(() => {
    if (gpaSelectionReady || !gpaLines.data?.students.length) return;
    setSelectedGpaMssvs(gpaLines.data.students.map((student) => student.mssv));
    setGpaSelectionReady(true);
  }, [gpaLines.data, gpaSelectionReady]);

  const availableGpaStudents = (gpaLines.data?.availableStudents ?? []).filter(
    (student) => !selectedGpaMssvs.includes(student.mssv),
  );
  const latestImportJob = importJobs.data?.[0];
  const canTriggerImport = role === 'DEAN_ADMIN' || role === 'LECTURER';

  if (!hasToken) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="dashboard-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">CVHT Dashboard 2.0</div>
          <h1>AI Co-Advisor cho truy vấn, cảnh báo bất thường và dự báo học vụ</h1>
        </div>
        <div className="hero-actions">
          <Link className="ghost-button" to="/dashboard/ai-assistant">
            Trợ lý AI
          </Link>
          <a className="ghost-button" href={DAA_WEB_URL}>
            DAA demo
          </a>
          <button
            className="ghost-button"
            onClick={() => {
              clearToken();
              window.location.assign('/');
            }}
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {pageError ? <p className="error-text">Lỗi tải dữ liệu: {pageError}</p> : null}

      <section className="sync-strip">
        <div className="sync-summary">
          <span className={`sync-dot ${latestImportJob?.status ?? 'idle'}`} />
          <div>
            <span className="metric-label">Đồng bộ dữ liệu DAA</span>
            <strong>
              {latestImportJob?.status === 'success' ? 'Đã đồng bộ' : latestImportJob?.status ?? 'Chưa có job'}
            </strong>
            <p>
              {latestImportJob?.createdAt
                ? `Cập nhật lúc ${formatDate(latestImportJob.createdAt)}`
                : 'Chưa có lần đồng bộ nào được ghi nhận.'}
            </p>
          </div>
        </div>
        <div className="sync-stat">
          <span>Nguồn</span>
          <strong>{formatSyncSource(latestImportJob?.sourceName)}</strong>
        </div>
        <div className="sync-stat">
          <span>Bản ghi</span>
          <strong>{(latestImportJob?.recordsProcessed ?? 0).toLocaleString('vi-VN')}</strong>
        </div>
        {canTriggerImport ? (
          <button
            className="primary-button compact-button"
            type="button"
            disabled={triggerImport.isPending}
            onClick={() => triggerImport.mutate()}
          >
            {triggerImport.isPending ? 'Đang fetch...' : 'Fetch từ DAA'}
          </button>
        ) : null}
      </section>

      <section className="kpi-grid">
        <KpiCard
          label="Tổng sinh viên"
          value={overview.data?.kpis.students ?? '--'}
          note="Số sinh viên trong phạm vi quyền hiện tại"
        />
        <KpiCard
          label="Rủi ro cao"
          value={overview.data?.kpis.highRisk ?? '--'}
          note="Sinh viên có Delay Risk Score từ 55%"
        />
        <KpiCard
          label="Nguy cấp"
          value={overview.data?.kpis.critical ?? '--'}
          note="Cần can thiệp ngay, ưu tiên nhắc lịch cố vấn"
        />
        <KpiCard
          label="Rủi ro trung bình"
          value={overview.data?.kpis.averageRisk != null ? `${overview.data.kpis.averageRisk}%` : '--'}
          note="Mức rủi ro trung bình toàn tập dữ liệu"
        />
      </section>

      {classes.data && classes.data.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Tài khoản hiện tại chưa được phân quyền lớp nào. Vui lòng đăng nhập bằng `advisor_1` hoặc `dean_admin`.
          </p>
        </section>
      ) : null}

      <section className="panel ai-brief-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Bảng tin AI</div>
            <h2>Bản tin AI cho lớp học</h2>
          </div>
          <Link className="ghost-button" to="/dashboard/ai-assistant">
            Mở trợ lý AI
          </Link>
        </div>
        <div className="ai-brief-layout">
          <div className="brief-list">
            {briefs.data?.map((brief) => (
              <article key={brief.classCode} className={`brief-card ${brief.priority}`}>
                <div className="brief-top">
                  <strong>{brief.classCode}</strong>
                  <span>{brief.priority === 'critical' ? 'Cần ưu tiên' : 'Ổn định'}</span>
                </div>
                <p>{brief.summary}</p>
                <div className="brief-metrics">
                  <span>Rớt mới: {brief.metrics.failedNow}</span>
                  <span>Cận ngưỡng: {brief.metrics.borderline}</span>
                  <span>Risk cao: {brief.metrics.highRiskCount}</span>
                </div>
              </article>
            ))}
          </div>

          <div className="pattern-list">
            <div>
              <div className="eyebrow">Mẫu rủi ro</div>
              <h3>Khuôn mẫu rớt môn</h3>
            </div>
            {patterns.data?.map((pattern, index) => (
              <div className="pattern-item" key={`${pattern.antecedentCode}-${pattern.consequentCode}-${index}`}>
                <strong>{pattern.antecedentName}</strong>
                <p>{pattern.message}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Predictive Analytics</div>
            <h2>Ma trận điểm sinh viên theo học kỳ</h2>
          </div>
          <div className="class-switcher">
            {classes.data?.map((classItem) => (
              <button
                key={classItem.id}
                className={classItem.id === selectedClassId ? 'chip active' : 'chip'}
                onClick={() =>
                  startTransition(() => {
                    setSelectedClassId(classItem.id);
                    setSelectedClassCode(classItem.class_code);
                  })
                }
              >
                {classItem.class_code}
              </button>
            ))}
          </div>
        </div>
        <div className="gpa-line-controls">
          <div>
            <span className="metric-label">Sinh viên đang hiển thị</span>
            <p className="muted">Mặc định chọn ngẫu nhiên 5 sinh viên trong lớp. Có thể bỏ bớt hoặc thêm MSSV theo ý muốn.</p>
          </div>
          <div className="gpa-add-control">
            <select value={gpaCandidate} onChange={(event) => setGpaCandidate(event.target.value)}>
              <option value="">Thêm sinh viên...</option>
              {availableGpaStudents.map((student) => (
                <option key={student.mssv} value={student.mssv}>
                  {student.fullName} · {student.mssv} · GPA {formatScore(student.currentGpa, 2)}
                </option>
              ))}
            </select>
            <button
              className="ghost-button"
              type="button"
              disabled={!gpaCandidate}
              onClick={() => {
                if (!gpaCandidate) return;
                setSelectedGpaMssvs((current) => [...current, gpaCandidate]);
                setGpaCandidate('');
                setGpaSelectionReady(true);
              }}
            >
              Thêm
            </button>
          </div>
        </div>
        <GpaLineChart
          data={gpaLines.data}
          onRemove={(mssv) => {
            setSelectedGpaMssvs((current) => (current.length > 1 ? current.filter((item) => item !== mssv) : current));
            setGpaSelectionReady(true);
          }}
        />
      </section>

      <section className="support-grid">
        <div className="panel student-list-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Khám phá lớp</div>
              <h2>{selectedClassCode || 'Chọn lớp'}</h2>
            </div>
            <span className="section-meta">{activeClassName || 'Danh sách sinh viên và điểm rủi ro'}</span>
          </div>
          <div className="student-stack">
            {students.data?.map((student) => {
              const risk = riskStudents.data?.find((item) => item.mssv === student.mssv);
              return (
                <button
                  key={student.id}
                  className={`student-tile ${selectedMssv === student.mssv ? 'active' : ''}`}
                  onClick={() => setSelectedMssv(student.mssv)}
                >
                  <div className="student-identity">
                    <strong className="student-name">{student.full_name}</strong>
                    <span className="student-code">{student.mssv}</span>
                  </div>
                  <div className="student-meta">
                    <span className="student-gpa">GPA {formatScore(student.current_gpa, 2)}</span>
                    <span
                      className={`risk-pill ${
                        student.academic_status === 'graduated' ? 'graduated' : risk?.riskBand || 'low'
                      }`}
                    >
                      {student.academic_status === 'graduated'
                        ? 'Đã tốt nghiệp'
                        : risk
                          ? `${riskLabel(Number(risk.delayRiskScore))} ${formatScore(risk.delayRiskScore, 0, '0')}%`
                          : 'Chưa có'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Bàn can thiệp sinh viên</div>
              <h2>{dashboard.data?.student.full_name || 'Chọn sinh viên'}</h2>
            </div>
          </div>

          {dashboard.data ? (
            <div className="detail-grid">
              <div className="detail-card accent">
                <span>MSSV</span>
                <strong>{dashboard.data.student.mssv}</strong>
                <p>{dashboard.data.student.class_code}</p>
              </div>
              <div className="detail-card">
                <span>Điểm rủi ro chậm tiến độ</span>
                <strong>
                  {dashboard.data.riskProfile?.delayRiskScore != null
                    ? `${dashboard.data.riskProfile.delayRiskScore.toFixed(1)}%`
                    : '--'}
                </strong>
                <p>{dashboard.data.riskProfile?.recommendedAction || 'Chưa có đề xuất'}</p>
              </div>
              <div className="detail-card">
                <span>Tín chỉ</span>
                <strong className="credit-progress-value">
                  <span>Hoàn thành</span>
                  <span>
                    {dashboard.data.creditProgress.completed} / {dashboard.data.creditProgress.required}
                  </span>
                </strong>
                <p>
                  {dashboard.data.creditProgress.debt > 0
                    ? `Còn ${dashboard.data.creditProgress.debt} tín chỉ môn rớt chưa học lại`
                    : 'Không có môn rớt chưa học lại'}
                </p>
              </div>
              <div className="detail-card">
                <span>Cảnh báo</span>
                <strong>{dashboard.data.alerts.length}</strong>
                <p>Cảnh báo học vụ đã sinh</p>
              </div>
            </div>
          ) : (
            <p className="muted">Chọn một sinh viên để xem chi tiết, cảnh báo và ghi chú cố vấn.</p>
          )}

          {dashboard.data ? (
            <div className="subpanel detail-jump-panel">
              <button
                type="button"
                className="detail-jump-card"
                onClick={() => navigate(`/dashboard/students/${selectedMssv}/overview`)}
              >
                <div>
                  <span className="metric-label">Chi tiết</span>
                  <strong>Xem đầy đủ hồ sơ sinh viên</strong>
                  <p>Gồm điểm chi tiết, tiến độ, GPA, tín chỉ, rủi ro, cảnh báo và nhật ký can thiệp.</p>
                </div>
                <span className="detail-jump-arrow">Mở</span>
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Hàng đợi ưu tiên</div>
            <h2>Top sinh viên cần can thiệp</h2>
          </div>
        </div>
        <div className="priority-grid">
          {(overview.data?.topRisks ?? []).map((student) => (
            <article className="priority-card" key={student.mssv}>
              <div className="priority-top">
                <strong>{student.fullName}</strong>
                <span className={`risk-pill ${student.riskBand}`}>{formatScore(student.delayRiskScore, 0, '0')}%</span>
              </div>
              <p>
                {student.mssv} • {student.classCode} • GPA {formatScore(student.currentGpa, 2)}
              </p>
              <p>{student.recommendedAction}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AIAssistantPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const navigate = useNavigate();
  const [chatPrompt, setChatPrompt] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadChatSessions());
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      apiFetch<ChatResult>('/ai/chat-to-data', {
        method: 'POST',
        body: JSON.stringify({ message, mode: inferPromptMode(message) }),
      }),
  });

  useEffect(() => {
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    localStorage.removeItem(LEGACY_CHAT_SESSIONS_STORAGE_KEY);
    if (!currentSessionId && sessions[0]) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [currentSessionId, sessions, chatMutation.isPending]);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const createNewSession = () => {
    const newSession = makeChatSession();
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    chatMutation.reset();
  };

  const deleteSession = (sessionId: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (!remaining.length) {
        const replacement = makeChatSession();
        setCurrentSessionId(replacement.id);
        return [replacement];
      }
      if (currentSessionId === sessionId) {
        setCurrentSessionId(remaining[0].id);
      }
      return remaining;
    });
    chatMutation.reset();
  };

  const appendMessageToSession = (sessionId: string, message: ChatMessage) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const nextMessages = [...session.messages, message];
        const shouldRename = session.title === 'Cuộc trò chuyện mới' && message.role === 'user';
        return {
          ...session,
          title: shouldRename ? getSessionTitle(message.content) : session.title,
          messages: nextMessages,
          updatedAt: Date.now(),
        };
      }),
    );
  };

  const ensureCurrentSessionId = () => {
    if (currentSessionId) return currentSessionId;
    const newSession = makeChatSession();
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    return newSession.id;
  };

  const clearCurrentSession = () => {
    if (!currentSessionId) return;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === currentSessionId
          ? {
              ...session,
              title: 'Cuộc trò chuyện mới',
              messages: [],
              updatedAt: Date.now(),
            }
          : session,
      ),
    );
    chatMutation.reset();
  };

  const deleteCurrentSession = () => {
    if (currentSessionId) deleteSession(currentSessionId);
  };

  const pageError = chatMutation.error instanceof Error && chatMutation.error.message;

  const submitPrompt = () => {
    const message = chatPrompt.trim();
    if (!message || chatMutation.isPending) return;

    const targetSessionId = ensureCurrentSessionId();
    const now = Date.now();
    appendMessageToSession(targetSessionId, {
      id: `${now}-user`,
      role: 'user',
      content: message,
      timestamp: now,
    });

    setChatPrompt('');
    chatMutation.reset();
    chatMutation.mutate(message, {
      onSuccess: (data) => {
        appendMessageToSession(targetSessionId, {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          content: data.answer,
          result: data,
          timestamp: Date.now(),
        });
      },
      onError: (error) => {
        appendMessageToSession(targetSessionId, {
          id: `${Date.now()}-assistant-error`,
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Không thể xử lý truy vấn này.',
          result: {
            mode: 'assistant',
            message,
            answer: error instanceof Error ? error.message : 'Không thể xử lý truy vấn này.',
            sqlPreview: null,
            rows: [],
            visualization: { type: 'none' },
            llmEnabled: false,
          },
          timestamp: Date.now(),
        });
      },
    });
  };

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  if (!hasToken) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={`assistant-with-sidebar ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <aside className={`assistant-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div>
            <span>CVHT AI</span>
            <h3>Đoạn chat</h3>
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Đóng thanh bên' : 'Mở thanh bên'}
            type="button"
          >
            {sidebarOpen ? '‹' : '☰'}
          </button>
        </div>

        <button className="new-chat-button" onClick={createNewSession} type="button">
          <span>+</span>
          Đoạn chat mới
        </button>

        <div className="sessions-section-title">Gần đây</div>
        <div className="sessions-list">
          {sortedSessions.map((session) => (
            <button
              key={session.id}
              className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
              onClick={() => {
                setCurrentSessionId(session.id);
                chatMutation.reset();
              }}
              type="button"
            >
              <span className="session-title">{session.title}</span>
              <span
                className="session-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteSession(session.id);
                }}
                role="button"
                tabIndex={0}
                title="Xóa đoạn chat"
              >
                ×
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button type="button" onClick={clearCurrentSession}>
            Xóa nội dung phiên
          </button>
          <button type="button" onClick={deleteCurrentSession}>
            Xóa phiên này
          </button>
        </div>
      </aside>

      <div className="assistant-main">
        <div className="assistant-shell">
          <header className="assistant-topbar">
            <div>
              <button
                className="sidebar-toggle-main"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                type="button"
                aria-label="Mở lịch sử chat"
              >
                ☰
              </button>
              <div className="eyebrow">AI Assistant Endpoint</div>
              <h1>Trợ lý AI học vụ</h1>
            </div>
            <div className="assistant-top-actions">
              <Link className="ghost-button" to="/dashboard">
                Về dashboard
              </Link>
              <button
                className="ghost-button"
                onClick={() => {
                  clearToken();
                  navigate('/');
                }}
                type="button"
              >
                Đăng xuất
              </button>
            </div>
          </header>

          <main className="assistant-chat-canvas">
            {pageError ? <p className="error-text">Lỗi trợ lý AI: {pageError}</p> : null}

            {(!currentSession || currentSession.messages.length === 0) && !chatMutation.isPending ? (
              <section className="assistant-welcome">
                <span className="assistant-orb">AI</span>
                <h2>Hỏi dữ liệu học vụ theo cách tự nhiên</h2>
                <p>Truy vấn rủi ro, phổ điểm, GPA, tín chỉ hoặc kế hoạch can thiệp bằng tiếng Việt.</p>
              </section>
            ) : null}

            {currentSession?.messages.map((msg) => (
              <div key={msg.id} className={`assistant-message-row ${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="assistant-user-bubble">{msg.content}</div>
                ) : (
                  <>
                    <div className="assistant-ai-mark">AI</div>
                    <div className="assistant-ai-message">
                      <ChatResultPanel result={msg.result} isPending={false} />
                    </div>
                  </>
                )}
              </div>
            ))}

            {chatMutation.isPending && (
              <div className="assistant-message-row ai">
                <div className="assistant-ai-mark">AI</div>
                <div className="assistant-ai-message">
                  <ChatResultPanel result={undefined} isPending={true} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </main>

          <section className="assistant-floating-composer">
            <textarea
              value={chatPrompt}
              onChange={(e) => setChatPrompt(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
              placeholder="Nhập câu hỏi"
              rows={1}
            />
            <div className="composer-meta">
              <span>CVHT AI</span>
              <button
                className="composer-send-button"
                type="button"
                disabled={chatMutation.isPending || !chatPrompt.trim()}
                onClick={submitPrompt}
              >
                {chatMutation.isPending ? '...' : 'Gửi'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StudentEndpointPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const { mssv = '', feature: featureParam } = useParams();
  const feature = normalizeStudentFeature(featureParam);
  const [note, setNote] = useState('');

  const tabs = useMemo(() => getStudentEndpointTabs(mssv), [mssv]);

  const profile = useQuery({
    queryKey: ['endpoint-profile-header', mssv],
    queryFn: () => apiFetch<StudentProfileResponse>(`/students/${mssv}/profile`),
    enabled: hasToken && !!mssv,
  });

  const overview = useQuery({
    queryKey: ['endpoint-dashboard', mssv],
    queryFn: () => apiFetch<DashboardResponse>(`/students/${mssv}/dashboard`),
    enabled: hasToken && !!mssv && feature === 'overview',
  });

  const gpaTrend = useQuery({
    queryKey: ['endpoint-gpa-trend', mssv],
    queryFn: () => apiFetch<Array<{ termCode: string; gpa: number }>>(`/students/${mssv}/gpa-trend`),
    enabled: hasToken && !!mssv && feature === 'gpa',
  });

  const grades = useQuery({
    queryKey: ['endpoint-grades', mssv],
    queryFn: () => apiFetch<StudentGradesResponse>(`/students/${mssv}/grades`),
    enabled: hasToken && !!mssv && feature === 'grades',
  });

  const creditProgress = useQuery({
    queryKey: ['endpoint-credit-progress', mssv],
    queryFn: () => apiFetch<CreditProgressResponse>(`/students/${mssv}/credit-progress`),
    enabled: hasToken && !!mssv && feature === 'credits',
  });

  const riskProfile = useQuery({
    queryKey: ['endpoint-risk-profile', mssv],
    queryFn: () => apiFetch<StudentRisk | null>(`/students/${mssv}/risk-profile`),
    enabled: hasToken && !!mssv && feature === 'risk',
  });

  const academicProgress = useQuery({
    queryKey: ['endpoint-academic-progress', mssv],
    queryFn: () => apiFetch<AcademicProgressResponse>(`/students/${mssv}/academic-progress`),
    enabled: hasToken && !!mssv && feature === 'policy',
  });

  const alerts = useQuery({
    queryKey: ['endpoint-alerts', mssv],
    queryFn: () => apiFetch<StudentAlert[]>(`/students/${mssv}/alerts`),
    enabled: hasToken && !!mssv && feature === 'alerts',
  });

  const notes = useQuery({
    queryKey: ['endpoint-notes', mssv],
    queryFn: () => apiFetch<Array<{ note: string; created_at: string }>>(`/students/${mssv}/notes`),
    enabled: hasToken && !!mssv && feature === 'notes',
  });

  const saveNote = useMutation({
    mutationFn: async () =>
      apiFetch(`/students/${mssv}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: async () => {
      setNote('');
      await notes.refetch();
    },
  });

  const pageError =
    (profile.error instanceof Error && profile.error.message) ||
    (overview.error instanceof Error && overview.error.message) ||
    (gpaTrend.error instanceof Error && gpaTrend.error.message) ||
    (grades.error instanceof Error && grades.error.message) ||
    (creditProgress.error instanceof Error && creditProgress.error.message) ||
    (riskProfile.error instanceof Error && riskProfile.error.message) ||
    (academicProgress.error instanceof Error && academicProgress.error.message) ||
    (alerts.error instanceof Error && alerts.error.message) ||
    (notes.error instanceof Error && notes.error.message);

  if (!hasToken) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="dashboard-shell endpoint-page">
      <header className="hero">
        <div>
          <h1>{profile.data?.full_name || mssv}</h1>
          <p className="hero-note">
            {profile.data ? `${profile.data.mssv} · ${profile.data.class_code}` : 'Đang tải hồ sơ sinh viên'}
          </p>
        </div>
        <Link className="ghost-button" to="/dashboard">
          Quay lại dashboard
        </Link>
      </header>

      {pageError ? <p className="error-text">Lỗi tải dữ liệu: {pageError}</p> : null}

      <section className="panel endpoint-page-card">
        <div className="endpoint-tabs" aria-label="Điều hướng endpoint sinh viên">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              className={`endpoint-tab ${feature === tab.id ? 'active' : ''}`}
              to={`/dashboard/students/${mssv}/${tab.id}`}
            >
              <span>{tab.label}</span>
            </Link>
          ))}
        </div>

        <div className="endpoint-panel">
          {feature === 'overview' ? (
            overview.isLoading ? (
              <p className="muted">Đang tải tổng quan...</p>
            ) : overview.data ? (
              <div className="endpoint-kv-grid">
                <div className="endpoint-kv-card">
                  <span>Sinh viên</span>
                  <strong>{overview.data.student.full_name}</strong>
                  <p>
                    {overview.data.student.mssv} · {overview.data.student.class_code}
                  </p>
                </div>
                <div className="endpoint-kv-card">
                  <span>GPA hiện tại</span>
                  <strong>{formatScore(overview.data.riskProfile?.currentGpa, 2)}</strong>
                  <p>{humanizeChatCell('academic_status', overview.data.riskProfile?.academicStatus)}</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Tín chỉ hoàn thành</span>
                  <strong>
                    {overview.data.creditProgress.completed} / {overview.data.creditProgress.required}
                  </strong>
                  <p>
                    {overview.data.creditProgress.debt > 0
                      ? `Còn ${overview.data.creditProgress.debt} tín chỉ môn rớt chưa học lại`
                      : 'Không có môn rớt chưa học lại'}
                  </p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Cảnh báo</span>
                  <strong>{overview.data.alerts.length}</strong>
                  <p>Cảnh báo học vụ đã sinh</p>
                </div>
              </div>
            ) : (
              <p className="muted">Chưa có dữ liệu tổng quan.</p>
            )
          ) : null}

          {feature === 'profile' ? (
            profile.isLoading ? (
              <p className="muted">Đang tải hồ sơ...</p>
            ) : profile.data ? (
              <div className="endpoint-kv-grid">
                <div className="endpoint-kv-card">
                  <span>Họ tên</span>
                  <strong>{profile.data.full_name}</strong>
                  <p>{profile.data.mssv}</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Lớp</span>
                  <strong>{profile.data.class_code}</strong>
                  <p>{profile.data.class_name}</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Ngành/hệ</span>
                  <strong>{profile.data.program_code || '--'}</strong>
                  <p>{profile.data.training_system || '--'}</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Trạng thái</span>
                  <strong>{humanizeChatCell('academic_status', profile.data.academic_status)}</strong>
                  <p>Khóa {profile.data.cohort_year || '--'}</p>
                </div>
              </div>
            ) : (
              <p className="muted">Chưa có dữ liệu hồ sơ.</p>
            )
          ) : null}

          {feature === 'gpa' ? (
            <div>
              <h3>Xu hướng điểm trung bình</h3>
              <MiniTrend items={gpaTrend.data ?? []} />
            </div>
          ) : null}

          {feature === 'grades' ? <GradeDetailPanel grades={grades.data} /> : null}

          {feature === 'credits' ? (
            creditProgress.isLoading ? (
              <p className="muted">Đang tải tín chỉ...</p>
            ) : creditProgress.data ? (
              <div className="endpoint-kv-grid">
                <div className="endpoint-kv-card">
                  <span>Đã hoàn thành</span>
                  <strong>
                    {creditProgress.data.completed} / {creditProgress.data.required}
                  </strong>
                  <p>Tín chỉ đạt hoặc được miễn</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Môn rớt chưa học lại</span>
                  <strong>{creditProgress.data.debt}</strong>
                  <p>Chỉ tính môn đã rớt và chưa học lại</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Tỷ lệ hoàn thành</span>
                  <strong>{Math.round((creditProgress.data.completed / Math.max(creditProgress.data.required, 1)) * 100)}%</strong>
                  <p>So với chuẩn tốt nghiệp</p>
                </div>
              </div>
            ) : (
              <p className="muted">Chưa có dữ liệu tín chỉ.</p>
            )
          ) : null}

          {feature === 'risk' ? (
            riskProfile.isLoading ? (
              <p className="muted">Đang tải hồ sơ rủi ro...</p>
            ) : riskProfile.data ? (
              <div className="endpoint-kv-grid">
                <div className="endpoint-kv-card">
                  <span>Điểm rủi ro</span>
                  <strong>{riskProfile.data.delayRiskScore.toFixed(1)}%</strong>
                  <p>{riskLabel(riskProfile.data.delayRiskScore)}</p>
                </div>
                <div className="endpoint-kv-card">
                  <span>Vùng ma trận</span>
                  <strong>{humanizeChatCell('quadrant', riskProfile.data.quadrant)}</strong>
                  <p>{riskProfile.data.riskBand}</p>
                </div>
                <div className="endpoint-kv-card wide">
                  <span>Khuyến nghị</span>
                  <strong>{riskProfile.data.recommendedAction}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">Chưa có hồ sơ rủi ro.</p>
            )
          ) : null}

          {feature === 'policy' ? <AcademicProgressPanel report={academicProgress.data} /> : null}

          {feature === 'alerts' ? (
            <div className="notice-list">
              {(alerts.data ?? []).length ? (
                (alerts.data ?? []).map((alert) => (
                  <div className="notice-card" key={alert.id}>
                    <strong>{humanizeChatCell('severity', alert.severity)}</strong>
                    <p>{alert.message}</p>
                    {alert.created_at ? <span>{formatDate(alert.created_at)}</span> : null}
                  </div>
                ))
              ) : (
                <p className="muted">Chưa có cảnh báo nào.</p>
              )}
            </div>
          ) : null}

          {feature === 'notes' ? (
            <div>
              <div className="notes-list">
                {(notes.data ?? []).length ? (
                  (notes.data ?? []).map((item, index) => (
                    <div className="note-item" key={`${item.created_at}-${index}`}>
                      <p>{item.note}</p>
                      <span>{formatDate(item.created_at)}</span>
                    </div>
                  ))
                ) : (
                  <p className="muted">Chưa có nhật ký can thiệp.</p>
                )}
              </div>
              <div className="note-form">
                <label className="note-form-field">
                  <span>Kế hoạch can thiệp</span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Nhập nội dung kế hoạch can thiệp"
                  />
                </label>
                <div className="note-form-actions">
                  <button
                    className="primary-button note-submit"
                    disabled={!note.trim() || saveNote.isPending}
                    onClick={() => saveNote.mutate()}
                  >
                    {saveNote.isPending ? 'Đang lưu...' : 'Lưu kế hoạch'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function DAADemoPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const navigate = useNavigate();
  const role = currentRole();
  const canUseDaa = hasToken && (role === 'DEAN_ADMIN' || role === 'LECTURER');
  const [selectedOfferingId, setSelectedOfferingId] = useState('');
  const [selectedMssv, setSelectedMssv] = useState('');

  const offerings = useQuery({
    queryKey: ['daa-offerings'],
    queryFn: () => apiFetch<DAAOffering[]>('/daa-demo/offerings'),
    enabled: canUseDaa,
  });
  const students = useQuery({
    queryKey: ['daa-offering-students', selectedOfferingId],
    queryFn: () => apiFetch<DAAStudentScore[]>(`/daa-demo/offerings/${selectedOfferingId}/students`),
    enabled: canUseDaa && !!selectedOfferingId,
  });
  const gradeDetail = useQuery({
    queryKey: ['daa-grade', selectedOfferingId, selectedMssv],
    queryFn: () =>
      apiFetch<DAAStudentScore>(`/daa-demo/offerings/${selectedOfferingId}/students/${selectedMssv}/grades`),
    enabled: canUseDaa && !!selectedOfferingId && !!selectedMssv,
  });
  const importJobs = useQuery({
    queryKey: ['daa-import-jobs'],
    queryFn: () => apiFetch<ImportJob[]>('/admin/import-jobs/recent'),
    enabled: canUseDaa,
  });
  const triggerImport = useMutation({
    mutationFn: () =>
      apiFetch<ImportJob>('/admin/import-jobs/trigger', {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'daa_demo_manual' }),
      }),
    onSuccess: async () => {
      await importJobs.refetch();
      window.setTimeout(() => void importJobs.refetch(), 2500);
      window.setTimeout(() => void importJobs.refetch(), 8000);
    },
  });

  useEffect(() => {
    if (hasToken && !canUseDaa) {
      clearToken();
    }
  }, [hasToken, canUseDaa]);

  useEffect(() => {
    if (!offerings.data?.length) {
      setSelectedOfferingId('');
      return;
    }
    const stillExists = offerings.data.some((offering) => offering.offeringId === selectedOfferingId);
    if (!selectedOfferingId || !stillExists) setSelectedOfferingId(offerings.data[0].offeringId);
  }, [offerings.data, selectedOfferingId]);

  useEffect(() => {
    if (!students.data?.length) {
      setSelectedMssv('');
      return;
    }
    const stillExists = students.data.some((student) => student.mssv === selectedMssv);
    if (!selectedMssv || !stillExists) setSelectedMssv(students.data[0].mssv);
  }, [students.data, selectedMssv]);

  if (!hasToken || !canUseDaa) {
    return <Navigate to="/" replace />;
  }

  const activeOffering = offerings.data?.find((item) => item.offeringId === selectedOfferingId);
  const latestJob = importJobs.data?.[0];
  const pageError =
    (offerings.error instanceof Error && offerings.error.message) ||
    (students.error instanceof Error && students.error.message) ||
    (gradeDetail.error instanceof Error && gradeDetail.error.message) ||
    (triggerImport.error instanceof Error && triggerImport.error.message);

  return (
    <div className="dashboard-shell daa-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">External Demo System</div>
          <h1>DAA demo - nguồn dữ liệu điểm từ giảng viên</h1>
          <p className="muted">Bấm Fetch từ DAA để tạo job đồng bộ điểm sang hệ thống CVHT.</p>
        </div>
        <div className="hero-actions">
          <a className="ghost-button" href={CVHT_WEB_URL}>
            Về CVHT
          </a>
          <button
            className="ghost-button"
            onClick={() => {
              clearToken();
              navigate('/');
            }}
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {pageError ? <p className="error-text">Lỗi tải dữ liệu: {pageError}</p> : null}

      <section className="sync-strip">
        <div className="sync-summary">
          <span className={`sync-dot ${latestJob?.status ?? 'idle'}`} />
          <div>
            <span className="metric-label">Đồng bộ dữ liệu DAA</span>
            <strong>{latestJob?.status === 'success' ? 'Đã đồng bộ' : latestJob?.status ?? 'Chưa có job'}</strong>
            <p>
              {latestJob?.createdAt
                ? `Cập nhật lúc ${formatDate(latestJob.createdAt)}`
                : 'Chưa có lần đồng bộ nào được ghi nhận.'}
            </p>
          </div>
        </div>
        <div className="sync-stat">
          <span>Nguồn</span>
          <strong>{formatSyncSource(latestJob?.sourceName)}</strong>
        </div>
        <div className="sync-stat">
          <span>Bản ghi</span>
          <strong>{(latestJob?.recordsProcessed ?? 0).toLocaleString('vi-VN')}</strong>
        </div>
        {canUseDaa ? (
          <button
            className="primary-button compact-button"
            type="button"
            disabled={triggerImport.isPending}
            onClick={() => triggerImport.mutate()}
          >
            {triggerImport.isPending ? 'Đang fetch...' : 'Fetch từ DAA'}
          </button>
        ) : null}
      </section>

      <section className="daa-grid">
        <aside className="panel daa-list">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Học phần phụ trách</div>
              <h2>{offerings.data?.length ?? 0} học phần</h2>
            </div>
          </div>
          <div className="daa-offering-list">
            {(offerings.data ?? []).map((offering) => (
              <button
                key={offering.offeringId}
                className={`daa-offering-card ${offering.offeringId === selectedOfferingId ? 'active' : ''}`}
                type="button"
                onClick={() => setSelectedOfferingId(offering.offeringId)}
              >
                <strong>
                  {offering.courseCode} - {offering.courseName}
                </strong>
                <span>
                  {offering.classCode} · {offering.termCode} · {offering.studentCount} SV
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="panel daa-detail">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Bảng điểm lớp học phần</div>
              <h2>{activeOffering ? `${activeOffering.courseCode} · ${activeOffering.classCode}` : 'Chọn học phần'}</h2>
            </div>
          </div>

          <div className="table-shell compact">
            <table>
              <thead>
                <tr>
                  <th>MSSV</th>
                  <th>Họ tên</th>
                  <th>Quá trình</th>
                  <th>Giữa kỳ</th>
                  <th>Thực hành</th>
                  <th>Cuối kỳ</th>
                  <th>Tổng kết</th>
                  <th>Chữ</th>
                </tr>
              </thead>
              <tbody>
                {(students.data ?? []).map((student) => (
                  <tr
                    key={student.mssv}
                    className={student.mssv === selectedMssv ? 'selected-row' : ''}
                    onClick={() => setSelectedMssv(student.mssv)}
                  >
                    <td>{student.mssv}</td>
                    <td>
                      <strong>{student.fullName}</strong>
                    </td>
                    <td>{formatScore(student.processScore, 1)}</td>
                    <td>{formatScore(student.midtermScore, 1)}</td>
                    <td>{formatScore(student.practicalScore, 1)}</td>
                    <td>{formatScore(student.finalScore, 1)}</td>
                    <td>{formatScore(student.overallScore, 1)}</td>
                    <td>{student.letterGrade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {gradeDetail.data ? (
            <div className="daa-grade-card">
              <div>
                <span className="metric-label">Chi tiết sinh viên</span>
                <h3>{gradeDetail.data.fullName}</h3>
                <p>
                  {gradeDetail.data.mssv} · {gradeDetail.data.courseCode} · {gradeDetail.data.termCode}
                </p>
              </div>
              <div className="endpoint-kv-grid">
                <div className="endpoint-kv-card">
                  <span>Quá trình</span>
                  <strong>{formatScore(gradeDetail.data.processScore, 1)}</strong>
                </div>
                <div className="endpoint-kv-card">
                  <span>Giữa kỳ</span>
                  <strong>{formatScore(gradeDetail.data.midtermScore, 1)}</strong>
                </div>
                <div className="endpoint-kv-card">
                  <span>Thực hành</span>
                  <strong>{formatScore(gradeDetail.data.practicalScore, 1)}</strong>
                </div>
                <div className="endpoint-kv-card">
                  <span>Tổng kết</span>
                  <strong>{formatScore(gradeDetail.data.overallScore, 1)}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </section>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard/ai-assistant" element={<AIAssistantPage />} />
      <Route path="/daa-demo" element={<DAADemoPage />} />
      <Route path="/dashboard/students/:mssv/:feature" element={<StudentEndpointPage />} />
    </Routes>
  );
}
