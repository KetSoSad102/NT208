import { useEffect, useMemo, useState, startTransition } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch, clearToken, setToken } from './api/client';

type ClassItem = { id: string; class_code: string; class_name: string };
type Student = { id: string; mssv: string; full_name: string; current_gpa: number | string | null };

type StudentRisk = {
  id?: string;
  mssv: string;
  fullName: string;
  classCode: string;
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
  alerts: Array<{ id: string; message: string; severity: string }>;
  notes: Array<{ note: string; created_at: string }>;
  riskProfile?: StudentRisk;
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

type MatrixPoint = {
  mssv: string;
  fullName: string;
  classCode: string;
  x: number;
  y: number;
  risk: number;
  quadrant: string;
  blinking: boolean;
};

type MatrixResponse = {
  points: MatrixPoint[];
  quadrants: Record<string, string>;
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

function riskLabel(score: number): string {
  if (score >= 75) return 'Nguy cấp';
  if (score >= 55) return 'Cao';
  if (score >= 35) return 'Trung bình';
  return 'Thấp';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('vi-VN');
}

function formatScore(value: unknown, digits = 2, fallback = '--'): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(digits);
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
  const [username, setUsername] = useState('advisor_1');
  const [password, setPassword] = useState('advisor123');
  const [error, setError] = useState('');

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
              navigate('/dashboard');
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
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
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
          <span>{item.termCode}</span>
        </div>
      ))}
    </div>
  );
}

function MatrixChart({ matrix }: { matrix?: MatrixResponse }) {
  if (!matrix) return <p className="muted">Đang tải ma trận rủi ro...</p>;
  const [zoom, setZoom] = useState(1);
  const zoomPercent = Math.round(zoom * 100);
  const baseHeight = 360;
  const canvasScale = zoom < 1 ? zoom : 1;
  const canvasSizeMultiplier = zoom > 1 ? zoom : 1;

  const occupiedSlots = new Map<string, number>();
  const plottedPoints = matrix.points.map((point) => {
    const normalizedX = Math.max(0, Math.min(point.x, 100));
    const normalizedY = Math.max(0, Math.min(point.y * 10, 100));
    const bucketX = Math.round(normalizedX / 4);
    const bucketY = Math.round(normalizedY / 6);
    const bucketKey = `${bucketX}:${bucketY}`;
    const collisions = occupiedSlots.get(bucketKey) ?? 0;
    occupiedSlots.set(bucketKey, collisions + 1);

    const offsetX = ((collisions % 4) - 1.5) * 1.8;
    const offsetY = (Math.floor(collisions / 4) % 3) * 3.2;
    const displayX = Math.max(3, Math.min(97, normalizedX + offsetX));
    const displayY = Math.max(5, Math.min(95, normalizedY + offsetY));
    const showLabel = point.risk >= 55 || collisions === 0;

    return {
      ...point,
      displayX,
      displayY,
      showLabel,
    };
  });

  return (
    <div className="matrix-shell">
      <div className="matrix-toolbar">
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
        <span className="helper-line">Mẹo: phóng to để tách các điểm đang đứng sát nhau ở vùng cuối.</span>
      </div>
      <div className="matrix-legend">
        <span>
          <strong>Trái → phải:</strong> tín chỉ tích lũy từ thấp đến cao.
        </span>
        <span>
          <strong>Dưới → trên:</strong> GPA từ thấp đến cao.
        </span>
        <span>
          <strong>Chấm đỏ nhấp nháy:</strong> nhóm cần ưu tiên can thiệp.
        </span>
      </div>
      <div className="matrix-grid">
        <div className="matrix-cell">Tín chỉ thấp - GPA thấp</div>
        <div className="matrix-cell">Tín chỉ thấp - GPA tạm ổn</div>
        <div className="matrix-cell">Tín chỉ ổn - GPA thấp</div>
        <div className="matrix-cell">Vùng an toàn</div>
      </div>
      <div className="matrix-plot">
        <div
          className="matrix-canvas"
          style={{
            width: `${canvasSizeMultiplier * 100}%`,
            height: `${baseHeight * canvasSizeMultiplier}px`,
            transform: `scale(${canvasScale})`,
          }}
        >
          <div className="matrix-y-scale">
            <span>GPA cao</span>
            <span>GPA trung bình</span>
            <span>GPA thấp</span>
          </div>
          {plottedPoints.map((point) => (
            <button
              key={point.mssv}
              className={`matrix-point ${point.blinking ? 'blinking' : ''}`}
              style={{ left: `${point.displayX}%`, bottom: `${point.displayY}%` }}
              title={`${point.fullName} • GPA ${point.y.toFixed(2)} • Rủi ro ${point.risk.toFixed(1)}% • Tín chỉ ${point.x.toFixed(1)}%`}
            >
              {point.showLabel ? <span>{point.mssv}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="axis-row">
        <span>Ít tín chỉ hơn</span>
        <span>Tín chỉ tích lũy (%)</span>
        <span>Gần hoàn thành hơn</span>
      </div>
      <div className="matrix-footnote">
        Ma trận này ưu tiên đọc theo vị trí: càng sang phải là sinh viên tích lũy tín chỉ tốt hơn, càng lên cao là GPA tốt hơn.
        Góc dưới bên trái là nhóm cần để mắt nhiều nhất; góc trên bên phải là nhóm an toàn hơn.
      </div>
    </div>
  );
}

function BarChart({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <p className="muted">Không có dữ liệu biểu đồ.</p>;
  const max = Math.max(...rows.map((row) => Number(row.count ?? 0)), 1);
  return (
    <div className="bar-chart">
      {rows.map((row, index) => (
        <div className="bar-row" key={`${row.bin}-${index}`}>
          <span>{String(row.bin)}</span>
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
  completedCredits: 'Tín chỉ tích lũy',
  requiredCredits: 'Tổng tín chỉ',
  debtCredits: 'Tín chỉ còn thiếu',
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
        <div className="helper-line">
          {result.llmEnabled
            ? `Mô hình đang dùng: ${result.provider}${result.mode ? ` • Chế độ: ${result.mode}` : ''}`
            : 'Nguồn dữ liệu: API /ai/chat-to-data'}
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

      {result.sqlPreview ? (
        <details className="sql-preview">
          <summary>Xem trước truy vấn / SQL</summary>
          <pre>{result.sqlPreview}</pre>
        </details>
      ) : null}
    </div>
  );
}

function DashboardPage() {
  const hasToken = Boolean(localStorage.getItem('cvht_token'));

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedClassCode, setSelectedClassCode] = useState('');
  const [selectedMssv, setSelectedMssv] = useState('');
  const [note, setNote] = useState('');
  const [chatPrompt, setChatPrompt] = useState('Cho tôi tổng quan rủi ro học vụ hiện tại');

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

  const matrix = useQuery({
    queryKey: ['risk-matrix', selectedClassCode],
    queryFn: () =>
      apiFetch<MatrixResponse>(
        `/ai/predictive/matrix${selectedClassCode ? `?classCode=${encodeURIComponent(selectedClassCode)}` : ''}`,
      ),
    enabled: hasToken,
  });

  const prompts = useMemo(() => {
    const classCodes = (classes.data ?? []).map((item) => item.class_code);
    const firstClass = classCodes[0];
    const secondClass = classCodes[1];

    return [
      firstClass
        ? `Liệt kê sinh viên lớp ${firstClass} có nguy cơ học vụ cao`
        : 'Liệt kê sinh viên có nguy cơ học vụ cao',
      secondClass
        ? `Top 5 sinh viên có GPA cao nhất lớp ${secondClass}`
        : 'Top 5 sinh viên có GPA cao nhất theo toàn bộ dữ liệu',
      'Vẽ biểu đồ phổ điểm theo một học phần đang mở',
      'Cho tôi tổng quan rủi ro học vụ hiện tại',
      'Gợi ý kế hoạch can thiệp 2 tuần cho sinh viên có GPA thấp',
    ];
  }, [classes.data]);

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

  const saveNote = useMutation({
    mutationFn: async () =>
      apiFetch(`/students/${dashboard.data?.student.mssv}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: async () => {
      setNote('');
      await dashboard.refetch();
    },
  });

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      apiFetch<ChatResult>('/ai/chat-to-data', {
        method: 'POST',
        body: JSON.stringify({ message, mode: inferPromptMode(message) }),
      }),
  });

  const activeClassName = classes.data?.find((item) => item.id === selectedClassId)?.class_name;
  const pageError =
    (classes.error instanceof Error && classes.error.message) ||
    (overview.error instanceof Error && overview.error.message) ||
    (students.error instanceof Error && students.error.message) ||
    (dashboard.error instanceof Error && dashboard.error.message) ||
    (riskStudents.error instanceof Error && riskStudents.error.message) ||
    (matrix.error instanceof Error && matrix.error.message);

  if (!hasToken) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="dashboard-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">CVHT Dashboard 2.0</div>
          <h1>AI Co-Advisor cho truy vấn, cảnh báo bất thường và dự báo học vụ</h1>
          <p>
            Tập trung vào 3 luồng việc: hỏi dữ liệu bằng tiếng Việt, nhận AI Brief mỗi khi có biến động điểm
            và ưu tiên can thiệp theo Delay Risk Score.
          </p>
        </div>
        <button
          className="ghost-button"
          onClick={() => {
            clearToken();
            window.location.assign('/');
          }}
        >
          Đăng xuất
        </button>
      </header>

      {pageError ? <p className="error-text">Lỗi tải dữ liệu: {pageError}</p> : null}

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

      <section className="main-grid">
        <div className="panel chat-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Chat-to-Data / Text-to-SQL</div>
              <h2>Trợ lý ảo học vụ</h2>
            </div>
          </div>
          <textarea
            value={chatPrompt}
            onChange={(e) => setChatPrompt(e.target.value)}
            placeholder="Hỏi dữ liệu hoặc xin tư vấn học vụ: top GPA, phổ điểm, kế hoạch can thiệp, mẫu nhắn nhắc học..."
          />
          <div className="prompt-strip">
            {prompts.map((prompt) => (
              <button key={prompt} className="chip" onClick={() => setChatPrompt(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
          <button
            className="primary-button"
            onClick={() => chatMutation.mutate(chatPrompt.trim())}
            disabled={chatMutation.isPending || !chatPrompt.trim()}
          >
            {chatMutation.isPending ? 'AI đang phân tích...' : 'Gửi truy vấn'}
          </button>
          <ChatResultPanel
            result={chatMutation.data}
            isPending={chatMutation.isPending}
            error={chatMutation.error instanceof Error ? chatMutation.error.message : undefined}
          />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Anomaly Detection</div>
              <h2>Bản tin AI cho lớp học</h2>
            </div>
          </div>
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
            <h3>Khuôn mẫu rớt môn</h3>
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
              <h2>Ma trận rủi ro sinh viên</h2>
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
        <p className="section-copy">
          Chấm đỏ nhấp nháy nằm trong vùng tín chỉ thấp và GPA thấp, cần được CVHT ưu tiên can thiệp.
        </p>
        <MatrixChart matrix={matrix.data} />
      </section>

      <section className="support-grid">
        <div className="panel student-list-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Khám phá lớp</div>
              <h2>{selectedClassCode || 'Chọn lớp'}</h2>
            </div>
            <span className="helper-line">{activeClassName || 'Danh sách sinh viên và điểm rủi ro'}</span>
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
                  <div>
                    <strong>{student.full_name}</strong>
                    <span>{student.mssv}</span>
                  </div>
                  <div className="student-meta">
                    <span>GPA {formatScore(student.current_gpa, 2)}</span>
                    <span className={`risk-pill ${risk?.riskBand || 'low'}`}>
                      {risk ? `${riskLabel(Number(risk.delayRiskScore))} ${formatScore(risk.delayRiskScore, 0, '0')}%` : 'Chưa có'}
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
                <strong>
                  {dashboard.data.creditProgress.completed} / {dashboard.data.creditProgress.required}
                </strong>
                <p>Nợ {dashboard.data.creditProgress.debt} tín chỉ</p>
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
            <>
              <div className="subpanel">
                <h3>Xu hướng điểm trung bình</h3>
                <MiniTrend items={dashboard.data.gpaTrend} />
              </div>

              <div className="subpanel">
                <h3>Cảnh báo gần đây</h3>
                <div className="notice-list">
                  {dashboard.data.alerts.length ? (
                    dashboard.data.alerts.map((alert) => (
                      <div className="notice-card" key={alert.id}>
                        <strong>{alert.severity}</strong>
                        <p>{alert.message}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Chưa có cảnh báo nào.</p>
                  )}
                </div>
              </div>

              <div className="subpanel">
                <h3>Nhật ký can thiệp</h3>
                <div className="notes-list">
                  {(dashboard.data.notes ?? []).map((item, index) => (
                    <div className="note-item" key={`${item.created_at}-${index}`}>
                      <p>{item.note}</p>
                      <span>{formatDate(item.created_at)}</span>
                    </div>
                  ))}
                </div>
                <div className="note-form">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ghi nhận phương án can thiệp, lịch hẹn, khuyến nghị học tập..."
                  />
                  <button
                    className="primary-button"
                    disabled={!note.trim() || saveNote.isPending}
                    onClick={() => saveNote.mutate()}
                  >
                    {saveNote.isPending ? 'Đang lưu...' : 'Lưu ghi chú can thiệp'}
                  </button>
                </div>
              </div>
            </>
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  );
}
