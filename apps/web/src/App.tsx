import { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch, clearToken, setToken } from './api/client';

const DEFAULT_ROUTE = import.meta.env.VITE_DEFAULT_ROUTE || '';

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
  gpaTrend: Array<{ termCode: string; gpa: number; minScore: number; maxScore: number }>;
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
  processScore: number;
  midtermScore: number;
  practicalScore: number;
  finalScore: number;
  overallScore: number;
  letterGrade: string;
  passed: boolean;
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

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

const riskBandLabels: Record<string, string> = {
  all: 'Tất cả',
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nguy cấp',
  graduated: 'Đã tốt nghiệp',
};

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

function currentUser(): string | null {
  const rawToken = localStorage.getItem('cvht_token');
  if (!rawToken) return null;
  try {
    const payload = JSON.parse(atob(rawToken.split('.')[1] ?? ''));
    return typeof payload.username === 'string' ? payload.username : payload.sub || null;
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

function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="eyebrow">Hệ thống CVHT AI</div>
        <h1>Đăng ký Cố vấn</h1>
        <p className="auth-copy">Đăng ký tài khoản cố vấn và gán cho lớp bạn quản lý.</p>

        <form
          className="auth-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              const res = await apiFetch<{ accessToken: string }>('/auth/register', {
                method: 'POST',
                body: JSON.stringify({ username, password, fullName, classCode }),
              });
              localStorage.setItem('cvht_token', res.accessToken);
              navigate('/dashboard');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Registration failed');
            }
          }}
        >
          <label>
            <span>Tên đăng nhập</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          </label>
          <label>
            <span>Mật khẩu</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </label>
          <label>
            <span>Họ và tên</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name" />
          </label>
          <label>
            <span>Mã lớp quản lý</span>
            <input value={classCode} onChange={(e) => setClassCode(e.target.value)} placeholder="Ví dụ: PMCL.2021.1" />
          </label>
          {error && <p className="error-text" style={{ gridColumn: '1 / -1' }}>{error}</p>}
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
            <button className="primary-button action-button" type="submit">
              Đăng ký và Đăng nhập
            </button>
            <Link to="/" className="ghost-button action-button">
              Quay lại đăng nhập
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

function DaaSyncPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const role = currentRole();
  const [daaCookie, setDaaCookie] = useState(() => localStorage.getItem('daa_cookie') || '');

  useEffect(() => {
    localStorage.setItem('daa_cookie', daaCookie);
  }, [daaCookie]);

  const canUseDaa = hasToken && (role === 'DEAN_ADMIN' || role === 'LECTURER' || role === 'ADVISOR');

  const importJobs = useQuery({
    queryKey: ['daa-import-jobs'],
    queryFn: () => apiFetch<ImportJob[]>('/admin/import-jobs/recent'),
    enabled: canUseDaa,
    refetchInterval: 5000,
  });

  const triggerImport = useMutation({
    mutationFn: (cookie: string) =>
      apiFetch<ImportJob>('/admin/import-jobs/trigger', {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'daa_demo_manual', daaCookie: cookie }),
      }),
    onSuccess: async () => {
      await importJobs.refetch();
    },
  });

  const navigate = useNavigate();
  useEffect(() => {
    if (hasToken && !canUseDaa) {
      navigate('/dashboard');
    }
  }, [hasToken, canUseDaa]);

  if (!hasToken || !canUseDaa) {
    return (
      <div className="dashboard-shell daa-shell">
        <p className="muted">Đang kiểm tra quyền...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-shell daa-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">Data Synchronization</div>
          <h1>Đồng bộ dữ liệu từ DAA</h1>
          <p className="muted">
            Nhập session cookie từ hệ thống DAA để bắt đầu quá trình đồng bộ điểm sinh viên sang hệ thống CVHT.
          </p>
        </div>
      </header>

      <section className="daa-sync-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div className="panel" style={{ padding: '24px', maxWidth: '600px' }}>
          <div className="panel-heading">
            <h2>Cấu hình đồng bộ</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="daa-cookie-input" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span className="metric-label">DAA Session Cookie</span>
              <textarea
                value={daaCookie}
                onChange={(e) => setDaaCookie(e.target.value)}
                placeholder="Nhập cookie từ trình duyệt (e.g. ASP.NET_SessionId=...)"
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  fontSize: '0.9rem',
                  background: 'rgba(255, 255, 255, 0.6)',
                  minHeight: '100px',
                  resize: 'vertical',
                  fontFamily: 'monospace'
                }}
              />
              <p className="muted" style={{ fontSize: '0.8rem' }}>
                Cookie này được dùng để xác thực quyền giảng viên khi truy xuất dữ liệu từ DAA.
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              style={{ width: 'fit-content' }}
              disabled={triggerImport.isPending || !daaCookie.trim()}
              onClick={() => triggerImport.mutate(daaCookie)}
            >
              {triggerImport.isPending ? 'Đang thực hiện...' : 'Bắt đầu đồng bộ'}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Lịch sử</div>
              <h2>Các tiến trình gần đây</h2>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nguồn</th>
                  <th>Trạng thái</th>
                  <th>Bản ghi</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {importJobs.data?.map((job) => (
                  <tr key={job.id}>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>{formatSyncSource(job.sourceName)}</td>
                    <td>
                      <span className={`badge ${job.status}`}>
                        {job.status === 'queued' ? 'Đang chờ' : 
                         job.status === 'running' ? 'Đang chạy' : 
                         job.status === 'success' ? 'Thành công' : 'Thất bại'}
                      </span>
                    </td>
                    <td>{job.recordsProcessed}</td>
                    <td className="error-text" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.errorMessage || '-'}
                    </td>
                  </tr>
                ))}
                {(!importJobs.data || importJobs.data.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center' }} className="muted">
                      Chưa có tiến trình nào được thực hiện.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function DAAEntryPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const role = currentRole();
  const [selectedOfferingId, setSelectedOfferingId] = useState('');
  const [selectedMssv, setSelectedMssv] = useState('');
  const [daaCookie, setDaaCookie] = useState(() => localStorage.getItem('daa_cookie') || '');

  // Form state for grade editing
  const [formScores, setFormScores] = useState({
    processScore: 0,
    practicalScore: 0,
    finalScore: 0,
  });

  useEffect(() => {
    localStorage.setItem('daa_cookie', daaCookie);
  }, [daaCookie]);

  const canUseDaa = hasToken && (role === 'DEAN_ADMIN' || role === 'LECTURER' || role === 'ADVISOR');

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

  // Sync form state when gradeDetail loads
  useEffect(() => {
    if (gradeDetail.data) {
      setFormScores({
        processScore: gradeDetail.data.processScore,
        practicalScore: gradeDetail.data.practicalScore,
        finalScore: gradeDetail.data.finalScore,
      });
    }
  }, [gradeDetail.data]);

  const importJobs = useQuery({
    queryKey: ['daa-import-jobs'],
    queryFn: () => apiFetch<ImportJob[]>('/admin/import-jobs/recent'),
    enabled: canUseDaa,
  });

  const triggerImport = useMutation({
    mutationFn: (cookie: string) =>
      apiFetch<ImportJob>('/admin/import-jobs/trigger', {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'daa_demo_manual', daaCookie: cookie }),
      }),
    onSuccess: async () => {
      await importJobs.refetch();
    },
  });

  const updateGrade = useMutation({
    mutationFn: (scores: Partial<DAAStudentScore>) =>
      apiFetch(`/daa-demo/offerings/${selectedOfferingId}/students/${selectedMssv}/grades`, {
        method: 'POST',
        body: JSON.stringify(scores),
      }),
    onSuccess: () => {
      void gradeDetail.refetch();
      void students.refetch();
    },
  });

  const navigate = useNavigate();
  useEffect(() => {
    if (hasToken && !canUseDaa) {
      navigate('/dashboard');
    }
  }, [hasToken, canUseDaa]);

  if (!hasToken || !canUseDaa) {
    return (
      <div className="dashboard-shell daa-shell">
        <p className="muted">Đang kiểm tra quyền...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-shell daa-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">Data Synchronization</div>
          <h1>DAA demo - nguồn dữ liệu điểm từ giảng viên</h1>
          <p className="muted">Bấm Fetch từ DAA để tạo job đồng bộ điểm sang hệ thống CVHT.</p>
        </div>
        <div className="hero-actions">
          <div className="daa-cookie-input" style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '320px' }}>
            <span className="metric-label">DAA Session Cookie</span>
            <input
              type="text"
              value={daaCookie}
              onChange={(e) => setDaaCookie(e.target.value)}
              placeholder="Nhập cookie từ trình duyệt (e.g. ASP.NET_SessionId=...)"
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                fontSize: '0.9rem',
                background: 'rgba(255, 255, 255, 0.6)'
              }}
            />
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={triggerImport.isPending || !daaCookie.trim()}
            onClick={() => triggerImport.mutate(daaCookie)}
          >
            {triggerImport.isPending ? 'Đang fetch...' : 'Fetch từ DAA'}
          </button>
        </div>
      </header>

      <section className="daa-grid">
        <aside className="panel daa-list">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Học phần</div>
              <h2>Danh sách học phần</h2>
            </div>
          </div>
          <div className="daa-offering-list">
            {offerings.data?.map((offering) => (
              <button
                key={offering.offeringId}
                className={`daa-offering-card ${offering.offeringId === selectedOfferingId ? 'active' : ''}`}
                onClick={() => {
                  setSelectedOfferingId(offering.offeringId);
                  setSelectedMssv('');
                }}
              >
                <strong>{offering.courseName}</strong>
                <span>{offering.classCode}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="panel daa-detail">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Sinh viên & Điểm</div>
              <h2>{selectedOfferingId ? 'Chi tiết học phần' : 'Chọn học phần để xem danh sách'}</h2>
            </div>
          </div>

          {selectedOfferingId ? (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>MSSV</th>
                    <th>Họ tên</th>
                    <th>Quá trình</th>
                    <th>Thực hành</th>
                    <th>Cuối kỳ</th>
                    <th>Tổng kết</th>
                  </tr>
                </thead>
                <tbody>
                  {students.data?.map((student) => (
                    <tr
                      key={student.mssv}
                      className={student.mssv === selectedMssv ? 'selected-row' : ''}
                      onClick={() => setSelectedMssv(student.mssv)}
                    >
                      <td>{student.mssv}</td>
                      <td>{student.fullName}</td>
                      <td>{formatScore(student.processScore, 1)}</td>
                      <td>{formatScore(student.practicalScore, 1)}</td>
                      <td>{formatScore(student.finalScore, 1)}</td>
                      <td>
                        <strong>{formatScore(student.overallScore, 1)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Vui lòng chọn một học phần từ danh sách bên trái.</p>
          )}

          {selectedMssv && gradeDetail.data ? (
            <div className="daa-grade-card">
              <div className="eyebrow">Cập nhật điểm</div>
              <h3>{gradeDetail.data.fullName}</h3>
              <div className="auth-grid">
                <label>
                  <span>Quá trình</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={formScores.processScore}
                    onChange={(e) => setFormScores({ ...formScores, processScore: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <span>Thực hành</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={formScores.practicalScore}
                    onChange={(e) => setFormScores({ ...formScores, practicalScore: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <span>Cuối kỳ</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={formScores.finalScore}
                    onChange={(e) => setFormScores({ ...formScores, finalScore: Number(e.target.value) })}
                  />
                </label>
                <div className="endpoint-kv-card">
                  <span>Tổng kết hiện tại</span>
                  <strong>{formatScore(gradeDetail.data.overallScore, 1)}</strong>
                </div>
              </div>
              <div style={{ marginTop: '20px' }}>
                <button
                  className="primary-button"
                  disabled={updateGrade.isPending}
                  onClick={() => updateGrade.mutate(formScores)}
                >
                  {updateGrade.isPending ? 'Đang cập nhật...' : 'Xác nhận cập nhật điểm'}
                </button>
              </div>
            </div>
          ) : null}
        </main>
      </section>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const isDaaOnly = DEFAULT_ROUTE === '/daa-demo';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (DEFAULT_ROUTE && localStorage.getItem('cvht_token')) {
    return <Navigate to={DEFAULT_ROUTE} replace />;
  }

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-portal">
        <section className="auth-portal-copy">
          <div className="eyebrow">{isDaaOnly ? 'DAA External System' : 'CVHT AI Suite'}</div>
          <h1>{isDaaOnly ? 'Đăng nhập DAA Demo' : 'Đăng nhập CVHT'}</h1>
          <p className="auth-copy">
            {isDaaOnly
              ? 'Cổng quản lý điểm dành cho giảng viên. Đăng nhập để cập nhật điểm và quản lý học phần.'
              : 'Cổng hỗ trợ cố vấn học tập với giao diện kiểu portal: thông tin rõ, mục truy cập nhanh và dữ liệu nổi bật.'}
          </p>
          <div className="portal-badge-grid">
            <span>Dashboard trực quan</span>
            <span>AI Assistant</span>
            <span>Rủi ro học vụ</span>
            <span>Thông báo nhanh</span>
          </div>
          <div className="portal-notice-card">
            <div>
              <span>Demo nhanh</span>
              <strong>Tài khoản mẫu đã sẵn sàng</strong>
            </div>
            <p>Không cần tạo mới. Dùng tài khoản mẫu để vào thẳng hệ thống và test các màn chính.</p>
          </div>
          <div className="portal-quick-links">
            <a href="#login-form">Đăng nhập</a>
            <Link to="/register">Đăng ký cố vấn</Link>
            <Link to={isDaaOnly ? '/daa-demo' : '/dashboard'}>Xem giao diện</Link>
          </div>
        </section>

        <form
          className="auth-portal-form"
          id="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setError('');
              const data = await apiFetch<{ accessToken: string }>('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
              });
              setToken(data.accessToken);
              navigate(DEFAULT_ROUTE || '/dashboard');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
            }
          }}
        >
          <div className="auth-grid">
            <label>
              <span>Tài khoản</span>
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
          {error ? <p className="error-text">{error}</p> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
            <button className="primary-button" type="submit">
              Đăng nhập hệ thống
            </button>
            <Link to="/register" className="ghost-button">
              Đăng ký cố vấn mới
            </Link>
          </div>
        </form>
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

function MiniTrend({ items }: { items: Array<{ termCode: string; gpa: number; minScore: number; maxScore: number }> }) {
  if (!items.length) return <p className="muted">Chưa có dữ liệu xu hướng GPA.</p>;
  const maxScale = 10;
  const gridTicks = [10, 8, 6, 4, 2, 0];
  
  return (
    <div className="mini-chart-container" style={{ position: 'relative', height: '280px', marginTop: '20px' }}>
      {/* Grid Lines Background */}
      <div className="mini-chart-grid" style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: '30px', 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'space-between',
        pointerEvents: 'none'
      }}>
        {gridTicks.map(tick => (
          <div key={tick} style={{ 
            borderTop: '1px dashed #e2e8f0', 
            height: '0', 
            position: 'relative' 
          }}>
            <span style={{ 
              position: 'absolute', 
              left: '-25px', 
              top: '-8px', 
              fontSize: '0.75rem', 
              color: '#94a3b8' 
            }}>{tick}</span>
          </div>
        ))}
      </div>

      {/* Bars/Candles */}
      <div className="mini-chart" style={{ 
        position: 'relative', 
        height: '100%', 
        paddingLeft: '30px',
        display: 'flex',
        alignItems: 'flex-end',
        gap: '20px'
      }}>
        {items.map((item) => {
          const highPercent = (item.maxScore / maxScale) * 100;
          const lowPercent = (item.minScore / maxScale) * 100;
          const avgPercent = (item.gpa / maxScale) * 100;
          
          return (
            <div className="mini-bar" key={item.termCode} style={{ 
              flex: 1, 
              height: 'calc(100% - 30px)', 
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'center'
            }} title={`Cao: ${item.maxScore}, Thấp: ${item.minScore}, TB: ${item.gpa}`}>
              
              {/* Range Line (Whisker) */}
              <div style={{ 
                position: 'absolute',
                bottom: `${lowPercent}%`,
                height: `${highPercent - lowPercent}%`,
                width: '2px',
                background: '#64748b',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1
              }}>
                {/* High Tick */}
                <div style={{ position: 'absolute', top: 0, left: '-4px', right: '-4px', height: '2px', background: '#64748b' }} />
                {/* Low Tick */}
                <div style={{ position: 'absolute', bottom: 0, left: '-4px', right: '-4px', height: '2px', background: '#64748b' }} />
              </div>

              {/* GPA Bar (Body) */}
              <div style={{ 
                position: 'absolute',
                bottom: `${avgPercent - 1}%`, // Center the marker on the GPA
                height: '6px',
                width: '100%',
                maxWidth: '40px',
                background: '#0f172a',
                borderRadius: '3px',
                zIndex: 2,
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }} />
              
              {/* Optional: Subtle fill from 0 to GPA */}
              <div style={{ 
                height: `${avgPercent}%`,
                width: '100%',
                maxWidth: '24px',
                background: 'linear-gradient(180deg, rgba(235, 177, 94, 0.4), rgba(15, 112, 145, 0.1))',
                borderRadius: '4px 4px 0 0'
              }} />

              <strong style={{ 
                fontSize: '0.875rem', 
                marginTop: '8px', 
                color: '#1e293b',
                position: 'absolute',
                bottom: '-20px'
              }}>{formatScore(item.gpa, 2)}</strong>
              
              <span style={{ 
                fontSize: '0.75rem', 
                color: '#64748b',
                position: 'absolute',
                bottom: '-38px',
                whiteSpace: 'nowrap'
              }}>{item.termCode}</span>
            </div>
          );
        })}
      </div>
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
  const padding = { top: 32, right: 34, bottom: 52, left: 62 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const yFor = (gpa: number) => padding.top + ((10 - Math.max(0, Math.min(10, gpa))) / 10) * plotHeight;
  const yTicks = [10, 8, 6, 4, 2, 0];

  const numTerms = data.termCodes.length;
  const numStudents = data.students.length;
  const termWidth = plotWidth / numTerms;
  const groupPadding = Math.max(12, termWidth * 0.15); // khoảng cách 2 bên của nhóm cột trong mỗi học kỳ
  const innerWidth = termWidth - 2 * groupPadding;
  const barSpacing = Math.max(1, Math.min(4, innerWidth * 0.04)); // khoảng cách giữa các cột trong nhóm
  const totalSpacing = barSpacing * (numStudents - 1);
  const barWidth = Math.max(6, (innerWidth - totalSpacing) / numStudents);

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
      <div className="gpa-line-plot" role="img" aria-label="Biểu đồ cột GPA ghép nhóm theo học kỳ">
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
            const xCenter = padding.left + index * termWidth + termWidth / 2;
            const xSeparator = padding.left + index * termWidth;
            return (
              <g key={termCode}>
                {index > 0 && (
                  <line
                    x1={xSeparator}
                    x2={xSeparator}
                    y1={padding.top}
                    y2={chartHeight - padding.bottom}
                    className="gpa-grid-line vertical"
                    style={{ strokeDasharray: '4 4' }}
                  />
                )}
                <text x={xCenter} y={chartHeight - 18} textAnchor="middle" className="gpa-axis-label" style={{ fontWeight: 'bold' }}>
                  {termCode}
                </text>
              </g>
            );
          })}
          {data.termCodes.map((termCode, termIndex) => {
            const groupLeft = padding.left + termIndex * termWidth + groupPadding;
            return data.students.map((student, studentIndex) => {
              const color = gpaLineColors[studentIndex % gpaLineColors.length];
              const gpaObj = student.series.find((s) => s.termCode === termCode);
              const gpa = gpaObj && gpaObj.gpa != null ? gpaObj.gpa : null;
              if (gpa == null) return null;

              const barHeight = (Math.max(0, Math.min(10, gpa)) / 10) * plotHeight;
              const y = padding.top + plotHeight - barHeight;
              const barLeft = groupLeft + studentIndex * (barWidth + barSpacing);

              return (
                <g key={`${student.mssv}-${termCode}`}>
                  <rect
                    x={barLeft}
                    y={y}
                    width={barWidth}
                    height={Math.max(2, barHeight)}
                    fill={color}
                    rx={Math.min(4, barWidth / 2.5)}
                    style={{ transition: 'all 0.3s ease' }}
                  >
                    <title>
                      {student.fullName} • {termCode} • GPA {gpa.toFixed(2)}
                    </title>
                  </rect>
                  {(barWidth > 18 || numStudents <= 3) && (
                    <g>
                      <text
                        x={barLeft + barWidth / 2}
                        y={y - 6}
                        textAnchor="middle"
                        className="gpa-node-label"
                        style={{ fill: color, fontSize: '10px', fontWeight: 'bold' }}
                      >
                        {gpa.toFixed(1)}
                      </text>
                    </g>
                  )}
                </g>
              );
            });
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

function humanizeChatCell(key: string, value: unknown): React.ReactNode {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
  }
  if (typeof value === 'boolean') {
    return value ? 'Có' : 'Không';
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (key === 'risk_band' || key === 'riskBand') {
      if (normalized === 'critical') return <span className="risk-pill critical">Nguy cấp</span>;
      if (normalized === 'high') return <span className="risk-pill high">Cao</span>;
      if (normalized === 'medium') return <span className="risk-pill medium">Trung bình</span>;
      if (normalized === 'low') return <span className="risk-pill low">Thấp</span>;
    }
    if (key === 'academic_status' || key === 'academicStatus') {
      if (normalized === 'graduated') return <span className="status-badge graduated" style={{ background: '#ecfdf5', color: '#047857', padding: '4px 8px', borderRadius: '999px', fontSize: '0.85em', fontWeight: 600 }}>Đã tốt nghiệp</span>;
      if (normalized === 'delayed') return <span className="status-badge delayed" style={{ background: '#fef2f2', color: '#991b1b', padding: '4px 8px', borderRadius: '999px', fontSize: '0.85em', fontWeight: 600 }}>Chậm tiến độ</span>;
      if (normalized === 'studying') return <span className="status-badge studying" style={{ background: '#eff6ff', color: '#1d4ed8', padding: '4px 8px', borderRadius: '999px', fontSize: '0.85em', fontWeight: 600 }}>Đang học</span>;
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

function parseInlineMarkdown(text: string): React.ReactNode[] {
  let parts: Array<{ type: 'text' | 'bold' | 'code'; content: string }> = [{ type: 'text', content: text }];
  
  parts = parts.flatMap(part => {
    if (part.type !== 'text') return [part];
    const subParts = part.content.split('**');
    return subParts.map((sub, idx) => ({
      type: idx % 2 === 1 ? 'bold' as const : 'text' as const,
      content: sub
    }));
  });
  
  parts = parts.flatMap(part => {
    if (part.type !== 'text') return [part];
    const subParts = part.content.split('`');
    return subParts.map((sub, idx) => ({
      type: idx % 2 === 1 ? 'code' as const : 'text' as const,
      content: sub
    }));
  });
  
  return parts.map((part, index) => {
    if (part.type === 'bold') {
      return <strong key={index} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{part.content}</strong>;
    }
    if (part.type === 'code') {
      return <code key={index} style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.9em', color: '#e11d48' }}>{part.content}</code>;
    }
    return part.content;
  });
}

function MarkdownText({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={i} style={{ height: '8px' }} />;
        }
        
        if (trimmed.startsWith('### ')) {
          return <h3 key={i} style={{ marginTop: '16px', marginBottom: '8px', fontWeight: 700, fontSize: '1.15rem', color: 'var(--brand-700)' }}>{parseInlineMarkdown(trimmed.substring(4))}</h3>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={i} style={{ marginTop: '20px', marginBottom: '10px', fontWeight: 800, fontSize: '1.3rem', color: 'var(--brand-800)' }}>{parseInlineMarkdown(trimmed.substring(3))}</h2>;
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={i} style={{ marginTop: '24px', marginBottom: '12px', fontWeight: 800, fontSize: '1.5rem', color: 'var(--brand-900)' }}>{parseInlineMarkdown(trimmed.substring(2))}</h1>;
        }
        
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
          return (
            <ul key={i} className="assistant-bullets" style={{ margin: '4px 0 4px 20px', listStyleType: 'disc' }}>
              <li style={{ paddingLeft: '4px' }}>{parseInlineMarkdown(trimmed.substring(2))}</li>
            </ul>
          );
        }
        
        const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
        if (numMatch) {
          return (
            <ol key={i} className="assistant-numbered-list" style={{ margin: '4px 0 4px 20px' }}>
              <li value={parseInt(numMatch[1], 10)} style={{ paddingLeft: '4px' }}>
                {parseInlineMarkdown(numMatch[2])}
              </li>
            </ol>
          );
        }
        
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote key={i} style={{ borderLeft: '3px solid var(--brand-500)', paddingLeft: '12px', margin: '8px 0', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              {parseInlineMarkdown(trimmed.substring(2))}
            </blockquote>
          );
        }
        
        return (
          <p key={i} style={{ margin: '4px 0', lineHeight: 1.6 }}>
            {parseInlineMarkdown(line)}
          </p>
        );
      })}
    </>
  );
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

  return (
    <div className="chat-result">
      <div className="assistant-answer">
        <div className="eyebrow">Phản hồi AI</div>
        <div className="assistant-answer-content">
          <MarkdownText text={result.answer} />
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
  const location = useLocation();
  const role = currentRole();
  const username = currentUser();

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedClassCode, setSelectedClassCode] = useState('');
  const [selectedMssv, setSelectedMssv] = useState('');
  const [selectedGpaMssvs, setSelectedGpaMssvs] = useState<string[]>([]);
  const [gpaSelectionReady, setGpaSelectionReady] = useState(false);
  const [gpaCandidate, setGpaCandidate] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'graduated' | 'low' | 'medium' | 'high' | 'critical'>('all');

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
  const isClassesView = location.pathname.includes('/dashboard/classes');

  const patterns = useQuery({
    queryKey: ['ai-patterns', isClassesView ? selectedClassId : 'all'],
    queryFn: () => {
      const path = isClassesView && selectedClassId ? `/ai/anomalies/patterns?classId=${selectedClassId}` : '/ai/anomalies/patterns';
      return apiFetch<Pattern[]>(path);
    },
    enabled: hasToken,
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

  const filteredClasses = useMemo(() => {
    const term = classSearch.trim().toLowerCase();
    if (!term) return classes.data ?? [];
    return (classes.data ?? []).filter((item) =>
      [item.class_code, item.class_name].some((field) => field.toLowerCase().includes(term)),
    );
  }, [classes.data, classSearch]);

  const filteredStudents = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    const studentsData = students.data ?? [];
    return studentsData.filter((student) => {
      const risk = riskStudents.data?.find((item) => item.mssv === student.mssv);
      const band = student.academic_status === 'graduated' ? 'graduated' : risk?.riskBand || 'low';
      const matchesSearch =
        !term ||
        student.full_name.toLowerCase().includes(term) ||
        student.mssv.toLowerCase().includes(term) ||
        student.class_code.toLowerCase().includes(term);
      const matchesRisk = riskFilter === 'all' || band === riskFilter;
      return matchesSearch && matchesRisk;
    });
  }, [students.data, riskStudents.data, studentSearch, riskFilter]);

  useEffect(() => {
    if (!filteredStudents.length) return;
    const stillVisible = filteredStudents.some((student) => student.mssv === selectedMssv);
    if (!selectedMssv || !stillVisible) {
      setSelectedMssv(filteredStudents[0].mssv);
    }
  }, [filteredStudents, selectedMssv]);

  const activeClassName = classes.data?.find((item) => item.id === selectedClassId)?.class_name;
  const pageError =
    (classes.error instanceof Error && classes.error.message) ||
    (overview.error instanceof Error && overview.error.message) ||
    (students.error instanceof Error && students.error.message) ||
    (dashboard.error instanceof Error && dashboard.error.message) ||
    (riskStudents.error instanceof Error && riskStudents.error.message) ||
    (gpaLines.error instanceof Error && gpaLines.error.message);

  useEffect(() => {
    setSelectedGpaMssvs([]);
    setGpaSelectionReady(false);
    setGpaCandidate('');
  }, [selectedClassCode]);

  useEffect(() => {
    if (gpaSelectionReady || !gpaLines.data?.students.length) return;
    setSelectedGpaMssvs(gpaLines.data.students.slice(0, 5).map((student) => student.mssv));
    setGpaSelectionReady(true);
  }, [gpaLines.data, gpaSelectionReady]);

  const availableGpaStudents = (gpaLines.data?.availableStudents ?? []).filter(
    (student) => !selectedGpaMssvs.includes(student.mssv),
  );

  const classInsights = [
    { label: 'Sinh viên', value: students.data?.length ?? 0 },
    { label: 'Đang hiển thị', value: filteredStudents.length },
    { label: 'Risk cao', value: riskStudents.data?.filter((item) => item.riskBand === 'high' || item.riskBand === 'critical').length ?? 0 },
    { label: 'Cần can thiệp', value: overview.data?.kpis.critical ?? 0 },
  ];

  return (
    <div className="dashboard-shell">
      <div className="welcome-card-portal">
        <div className="welcome-avatar-circle">
          {username ? username.slice(0, 2).toUpperCase() : 'ND'}
        </div>
        <div className="welcome-card-body">
          <span className="welcome-card-eyebrow">XIN CHÀO,</span>
          <h2 className="welcome-card-name">{username || 'Cố vấn học tập'}</h2>
          <p className="welcome-card-sub">
            {role === 'DEAN_ADMIN' ? 'Dean Admin' : role === 'ADVISOR' ? 'Cố vấn học tập' : 'Người dùng'} • {isClassesView ? `Lớp quản lý: ${selectedClassCode || 'Demo'}` : 'Hệ thống hỗ trợ CVHT thông minh'}
          </p>
        </div>
        <div className="welcome-card-badges">
          <span className="welcome-badge status-active">Đang làm việc</span>
          <span className="welcome-badge year-badge">2026</span>
          <span className="welcome-badge term-badge">Học kỳ II</span>
        </div>
      </div>

      {pageError ? <p className="error-text">Lỗi tải dữ liệu: {pageError}</p> : null}

      {!isClassesView ? (
        <>
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

          <section className="panel ai-brief-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Bảng tin AI</div>
                <h2>Bản tin AI cho lớp học</h2>
                <p className="section-meta">Phân tích tự động các biến động và mẫu rủi ro từ dữ liệu mới nhất.</p>
              </div>
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

              {patterns.data?.length ? (
                <div className="pattern-list">
                  <div>
                    <div className="eyebrow">Mẫu rủi ro</div>
                    <h3>Khuôn mẫu rớt môn</h3>
                    <p className="muted">Liệt kê tất cả các môn học có sinh viên rớt trong phạm vi quản lý.</p>
                  </div>
                  {patterns.data.map((pattern, index) => (
                    <div className="pattern-item" key={`${pattern.antecedentCode}-${pattern.consequentCode}-${index}`}>
                      <strong>{pattern.antecedentName}</strong>
                      <p>{pattern.message}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Hàng đợi ưu tiên</div>
                <h2>Top sinh viên cần can thiệp</h2>
                <p className="section-meta">Danh sách đề xuất sinh viên cần liên hệ dựa trên điểm rủi ro và cảnh báo.</p>
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
        </>
      ) : (
        <>
          <div className="page-section-header" style={{ marginBottom: '24px' }}>
            <div className="eyebrow">Predictive Analytics</div>
            <h2 style={{ fontFamily: 'var(--title-font)', fontSize: '2rem', margin: '4px 0' }}>Ma trận điểm sinh viên theo học kỳ</h2>
            <p className="muted">Phân tích xu hướng điểm số và dự báo kết quả học tập của từng sinh viên trong lớp.</p>
          </div>

          <div className="class-selection-bar" style={{ 
            background: 'var(--surface)', 
            padding: '20px 24px', 
            borderRadius: '20px', 
            border: '1px solid var(--border)', 
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="metric-label" style={{ fontSize: '0.85rem' }}>Chọn lớp học để phân tích:</span>
              <input
                className="class-search-input"
                value={classSearch}
                onChange={(event) => setClassSearch(event.target.value)}
                placeholder="Tìm lớp theo mã hoặc tên"
              />
              <div className="class-switcher" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {filteredClasses.map((classItem) => (
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
          </div>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Dữ liệu dự báo</div>
                <h2>Biểu đồ xu hướng lớp {selectedClassCode}</h2>
              </div>
            </div>
            <div className="gpa-line-controls">
              <div>
                <span className="metric-label">Sinh viên đang hiển thị</span>
                <p className="muted">Mặc định chọn 5 sinh viên đầu tiên trong lớp. Có thể bỏ bớt hoặc thêm MSSV theo ý muốn.</p>
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
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!gpaLines.data?.students.length}
                  onClick={() => {
                    if (!gpaLines.data?.students.length) return;
                    setSelectedGpaMssvs(gpaLines.data.students.slice(0, 5).map((student) => student.mssv));
                    setGpaSelectionReady(true);
                  }}
                >
                  Reset 5 sinh viên
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
              <div className="student-filter-bar">
                <input
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="Tìm sinh viên theo tên, MSSV hoặc lớp"
                />
                <div className="chip-row">
                  {(['all', 'graduated', 'low', 'medium', 'high', 'critical'] as const).map((band) => (
                    <button
                      key={band}
                      type="button"
                      className={riskFilter === band ? 'chip active' : 'chip'}
                      onClick={() => setRiskFilter(band)}
                    >
                      {riskBandLabels[band]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="student-stack">
                {filteredStudents.map((student) => {
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
                {!filteredStudents.length ? <p className="muted">Không tìm thấy sinh viên phù hợp với bộ lọc hiện tại.</p> : null}
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

          {patterns.data?.length ? (
            <section className="panel" style={{ marginTop: '24px' }}>
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">Phân tích rủi ro lớp</div>
                  <h2>Khuôn mẫu rớt môn của lớp</h2>
                  <p className="section-meta">Danh sách các môn học có sinh viên rớt trong lớp đang chọn.</p>
                </div>
              </div>
              <div className="pattern-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '20px' }}>
                {patterns.data.map((pattern, index) => (
                  <div className="pattern-item" key={`${pattern.antecedentCode}-${index}`} style={{ padding: '20px', borderRadius: '16px', border: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
                    <strong style={{ display: 'block', fontSize: '1.15rem', marginBottom: '6px', fontFamily: 'var(--title-font)' }}>{pattern.antecedentName}</strong>
                    <p className="muted" style={{ margin: 0, fontSize: '0.94rem', lineHeight: '1.5' }}>{pattern.message}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}


function AIAssistantPage() {
  const navigate = useNavigate();
  const [chatPrompt, setChatPrompt] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadChatSessions());
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const quickPrompts = useMemo(
    () => [
      'Top 10 sinh viên rủi ro cao của lớp đang chọn là ai?',
      'Phân tích xu hướng GPA của lớp và nêu sinh viên cần can thiệp.',
      'Môn học nào có tỷ lệ rớt cao nhất trong dữ liệu hiện tại?',
      'Soạn cho tôi một kế hoạch liên hệ sinh viên có nguy cơ trễ tiến độ.',
    ],
    [],
  );

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

  const submitMessage = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || chatMutation.isPending) return;

    const targetSessionId = ensureCurrentSessionId();
    const now = Date.now();
    appendMessageToSession(targetSessionId, {
      id: `${now}-user`,
      role: 'user',
      content: trimmed,
      timestamp: now,
    });

    setChatPrompt('');
    chatMutation.reset();
    chatMutation.mutate(trimmed, {
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
            message: trimmed,
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

  const submitPrompt = () => {
    const message = chatPrompt.trim();
    if (!message || chatMutation.isPending) return;
    submitMessage(message);
  };

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);



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
            <div className="topbar-left">
              <button
                className="sidebar-toggle-main"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                type="button"
                aria-label="Mở lịch sử chat"
              >
                ☰
              </button>
              <div>
                <div className="eyebrow">CVHT AI Companion</div>
                <h1>Trợ lý AI học vụ</h1>
              </div>
            </div>
            <div className="assistant-top-actions">
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
              placeholder="Hỏi trợ lý CVHT AI (ví dụ: Soạn kế hoạch liên hệ sinh viên có nguy cơ)..."
              rows={1}
            />
            <button
              className="composer-send-button"
              type="button"
              disabled={chatMutation.isPending || !chatPrompt.trim()}
              onClick={submitPrompt}
              aria-label="Gửi tin nhắn"
            >
              {chatMutation.isPending ? (
                <span className="composer-loading-spinner" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              )}
            </button>
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
  const [copyStatus, setCopyStatus] = useState('');

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
    queryFn: () => apiFetch<Array<{ termCode: string; gpa: number; minScore: number; maxScore: number }>>(`/students/${mssv}/gpa-trend`),
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

  const handleCopyMssv = async () => {
    const copied = await copyText(mssv);
    setCopyStatus(copied ? 'Đã sao chép MSSV' : 'Không thể sao chép');
    window.setTimeout(() => setCopyStatus(''), 1800);
  };

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



  return (
    <div className="dashboard-shell endpoint-page">
      <div className="page-header">
        <div>
          <h1>{profile.data?.full_name || mssv}</h1>
          <p className="muted">
            {profile.data ? `${profile.data.mssv} · ${profile.data.class_code}` : 'Đang tải hồ sơ sinh viên'}
          </p>
        </div>
        <div className="page-actions">
          <button className="ghost-button compact-button" type="button" onClick={handleCopyMssv} disabled={!mssv}>
            Sao chép MSSV
          </button>
          <Link className="primary-button compact-button" to="/dashboard/ai-assistant">
            Hỏi AI về sinh viên
          </Link>
          {copyStatus ? <span className="copy-status">{copyStatus}</span> : null}
        </div>
      </div>

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

function MainLayout() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));
  const navigate = useNavigate();
  const location = useLocation();
  const role = currentRole();
  const username = currentUser();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const isDaaOnly = DEFAULT_ROUTE === '/daa-demo';

  if (!hasToken) {
    return <Navigate to="/" replace />;
  }

  const sections = isDaaOnly
    ? [
        {
          title: 'HỌC VỤ DAA',
          items: [{ id: 'daa-demo', label: 'Quản lý điểm', path: '/daa-demo', icon: '📝' }],
        },
      ]
    : [
        {
          title: 'TỔNG QUAN',
          items: [{ id: 'dashboard', label: 'Trang chủ', path: '/dashboard', icon: '🏠' }],
        },
        {
          title: 'HỌC VỤ',
          items: [
            { id: 'classes', label: 'Quản lý lớp', path: '/dashboard/classes', icon: '🏫' },
            { id: 'daa-sync', label: 'Đồng bộ dữ liệu', path: '/dashboard/daa-sync', icon: '🔄' },
          ],
        },
        {
          title: 'AI ASSISTANT',
          items: [{ id: 'ai-assistant', label: 'Trợ lý AI', path: '/dashboard/ai-assistant', icon: '🤖' }],
        },
      ];

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo-container">
            <span className="brand-logo-icon">🎓</span>
            {!isSidebarCollapsed && (
              <span className="brand-logo-text">
                <strong>CVHT Portal</strong> <span className="brand-logo-sub">AI</span>
              </span>
            )}
          </div>
          {!isSidebarCollapsed && (
            <div className="brand-user-card">
              <div className="brand-user-avatar">
                {username ? username.slice(0, 2).toUpperCase() : 'ND'}
              </div>
              <div className="brand-user-details">
                <div className="brand-user">{username || 'Người dùng'}</div>
                <div className="brand-role">
                  {isDaaOnly ? 'Lecturer' : role === 'DEAN_ADMIN' ? 'Dean Admin' : role === 'ADVISOR' ? 'Advisor' : 'User'}
                </div>
              </div>
            </div>
          )}
        </div>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.title} className="sidebar-section">
              {!isSidebarCollapsed && <div className="sidebar-section-title">{section.title}</div>}
              <div className="sidebar-section-items">
                {section.items.map((item) => (
                  <Link
                    key={item.id}
                    to={item.path}
                    className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                    title={isSidebarCollapsed ? item.label : ''}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="sidebar-collapse-btn-bottom"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? 'Mở rộng' : 'Thu nhỏ'}
            type="button"
          >
            <span className="nav-icon">{isSidebarCollapsed ? '›' : '‹'}</span>
            {!isSidebarCollapsed && <span className="nav-label">Thu gọn</span>}
          </button>
          <button
            className="ghost-button logout-button"
            onClick={() => {
              clearToken();
              navigate('/');
            }}
          >
            {isSidebarCollapsed ? '⏻' : 'Đăng xuất'}
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
export function App() {
  const isDaaOnly = DEFAULT_ROUTE === '/daa-demo';

  if (isDaaOnly) {
    return (
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<MainLayout />}>
          <Route path="/daa-demo" element={<DAAEntryPage />} />
          <Route path="*" element={<Navigate to="/daa-demo" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<MainLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/classes" element={<DashboardPage />} />
        <Route path="/dashboard/ai-assistant" element={<AIAssistantPage />} />
        <Route path="/dashboard/students/:mssv/:feature" element={<StudentEndpointPage />} />
        <Route path="/dashboard/daa-sync" element={<DaaSyncPage />} />
      </Route>
    </Routes>
  );
}
