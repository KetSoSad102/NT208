import { pool } from '../db/pool.js';

type ProgramCode = 'ATTT' | 'MMTTTDL' | 'UNKNOWN';
type TrainingSystem = 'Tài năng' | 'Đại trà' | 'Không xác định';

type CurriculumCourse = {
  code?: string;
  name: string;
  credits?: number;
  group: string;
  term?: number;
};

type Curriculum = {
  program: Exclude<ProgramCode, 'UNKNOWN'>;
  programName: string;
  totalCredits: number;
  timelineAvailable: boolean;
  timelineSourceNote: string;
  courses: CurriculumCourse[];
};

type EnrollmentRow = {
  term_code: string;
  term_name: string;
  start_date: string;
  course_code: string;
  course_name: string;
  credits: number;
  final_score: number;
  letter_grade: string;
};

type TermProgressStatus = 'normal' | 'delayed' | 'in_progress_warning';

export type AcademicProgressReport = {
  student: {
    id: string;
    mssv: string;
    fullName: string;
    classCode: string;
  };
  identification: {
    program: ProgramCode;
    programName: string;
    trainingSystem: TrainingSystem;
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
    status: TermProgressStatus;
    reason: string;
  }>;
  failedCourses: Array<{
    termCode: string;
    courseCode: string;
    courseName: string;
    credits: number;
    finalScore: number;
    letterGrade: string;
  }>;
  missingCourses: {
    status: 'computed' | 'timeline_missing' | 'unknown_program';
    note: string;
    items: CurriculumCourse[];
  };
  currentRegistration: {
    termCode?: string;
    currentCredits: number;
    minimumCredits: number;
    additionalCreditsNeeded: number;
    recommendationNote: string;
    suggestedCourses: CurriculumCourse[];
  };
};

const MIN_MAIN_TERM_CREDITS = 14;
const MAX_MAIN_TERM_CREDITS = 30;

const ATTT_CURRICULUM: Curriculum = {
  program: 'ATTT',
  programName: 'An toàn thông tin',
  totalCredits: 135,
  timelineAvailable: true,
  timelineSourceNote:
    'Baseline đang dùng danh mục môn từ sơ đồ ATTT và phân kỳ seed theo 7 học kỳ chính + học kỳ 8 tốt nghiệp.',
  courses: [
    { code: 'MA006', name: 'Giải tích', credits: 4, group: 'Đại cương' },
    { code: 'MA003', name: 'Đại số tuyến tính', credits: 3, group: 'Đại cương' },
    { code: 'MA004', name: 'Cấu trúc rời rạc', credits: 4, group: 'Đại cương' },
    { code: 'MA005', name: 'Xác suất thống kê', credits: 3, group: 'Đại cương' },
    { code: 'ENG01', name: 'Anh văn 1', credits: 4, group: 'Đại cương' },
    { code: 'ENG02', name: 'Anh văn 2', credits: 4, group: 'Đại cương' },
    { code: 'ENG03', name: 'Anh văn 3', credits: 4, group: 'Đại cương' },
    { code: 'IT001', name: 'Nhập môn lập trình', credits: 4, group: 'Đại cương' },
    { code: 'PH002', name: 'Nhập môn mạch số', credits: 4, group: 'Đại cương' },
    { code: 'SS004', name: 'Kỹ năng nghề nghiệp', credits: 2, group: 'Đại cương' },
    { code: 'SS003', name: 'Tư tưởng Hồ Chí Minh', credits: 2, group: 'Đại cương' },
    { code: 'SS006', name: 'Pháp luật đại cương', credits: 2, group: 'Đại cương' },
    { code: 'SS007', name: 'Triết học Mác - Lênin', credits: 3, group: 'Đại cương' },
    { code: 'IT002', name: 'Lập trình hướng đối tượng', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT003', name: 'Cấu trúc dữ liệu và giải thuật', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT004', name: 'Cơ sở dữ liệu', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT005', name: 'Nhập môn Mạng máy tính', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT006', name: 'Kiến trúc máy tính', credits: 3, group: 'Cơ sở ngành' },
    { code: 'IT007', name: 'Hệ điều hành', credits: 4, group: 'Cơ sở ngành' },
    { code: 'NT015', name: 'Giới thiệu ngành ATTT', credits: 1, group: 'Cơ sở ngành' },
    { name: 'Lập trình mạng căn bản', group: 'Cơ sở ngành' },
    { name: 'Cơ chế hoạt động của mã độc', group: 'Cơ sở ngành' },
    { code: 'NT219', name: 'Mật mã học', credits: 3, group: 'Cơ sở ngành' },
    { name: 'An toàn mạng', group: 'Cơ sở ngành' },
    { name: 'Quản trị mạng và hệ thống', group: 'Cơ sở ngành' },
    { code: 'NT209', name: 'Lập trình hệ thống', credits: 3, group: 'Cơ sở ngành' },
    { name: 'Lập trình ứng dụng Web', group: 'Cơ sở ngành' },
    { name: 'Lập trình an toàn và khai thác lỗ hổng phần mềm', group: 'Cơ sở ngành' },
    { name: 'Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập', group: 'Chuyên ngành' },
    { name: 'An toàn mạng không dây và di động', group: 'Chuyên ngành' },
    { name: 'Quản lý rủi ro và an toàn thông tin trong doanh nghiệp', group: 'Chuyên ngành' },
    { name: 'Kỹ thuật phân tích mã độc', group: 'Chuyên ngành' },
    { name: 'Bảo mật web và ứng dụng', group: 'Chuyên ngành' },
    { name: 'Pháp chứng kỹ thuật số', group: 'Chuyên ngành' },
    { name: 'An toàn mạng máy tính nâng cao', group: 'Chuyên ngành' },
    { name: 'Bảo mật Internet of things', group: 'Chuyên ngành' },
    { name: 'An ninh nhân sự, định danh và chứng thực', group: 'Chuyên ngành' },
    { name: 'An toàn dữ liệu, khôi phục thông tin sau sự cố', group: 'Chuyên ngành' },
    { name: 'An toàn kiến trúc hệ thống', group: 'Chuyên ngành' },
    { name: 'An toàn thông tin trong kỷ nguyên Máy tính lượng tử', group: 'Chuyên ngành' },
    { name: 'Tấn công mạng', group: 'Chuyên ngành' },
  ],
};

const MMT_CURRICULUM: Curriculum = {
  program: 'MMTTTDL',
  programName: 'Mạng máy tính và Truyền thông dữ liệu',
  totalCredits: 122,
  timelineAvailable: true,
  timelineSourceNote:
    'Baseline đang dùng danh mục môn từ sơ đồ MMT&TTDL và phân kỳ seed theo 7 học kỳ chính + học kỳ 8 tốt nghiệp.',
  courses: [
    { code: 'MA006', name: 'Giải tích', credits: 4, group: 'Đại cương' },
    { code: 'MA003', name: 'Đại số tuyến tính', credits: 3, group: 'Đại cương' },
    { code: 'MA004', name: 'Cấu trúc rời rạc', credits: 4, group: 'Đại cương' },
    { code: 'MA005', name: 'Xác suất thống kê', credits: 3, group: 'Đại cương' },
    { code: 'ENG01', name: 'Anh văn 1', credits: 4, group: 'Đại cương' },
    { code: 'ENG02', name: 'Anh văn 2', credits: 4, group: 'Đại cương' },
    { code: 'ENG03', name: 'Anh văn 3', credits: 4, group: 'Đại cương' },
    { code: 'IT001', name: 'Nhập môn lập trình', credits: 4, group: 'Đại cương' },
    { code: 'PH002', name: 'Nhập môn mạch số', credits: 4, group: 'Đại cương' },
    { code: 'SS004', name: 'Kỹ năng nghề nghiệp', credits: 2, group: 'Đại cương' },
    { code: 'SS003', name: 'Tư tưởng Hồ Chí Minh', credits: 2, group: 'Đại cương' },
    { code: 'SS006', name: 'Pháp luật đại cương', credits: 2, group: 'Đại cương' },
    { code: 'SS007', name: 'Triết học Mác - Lênin', credits: 3, group: 'Đại cương' },
    { code: 'IT002', name: 'Lập trình hướng đối tượng', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT003', name: 'Cấu trúc dữ liệu và giải thuật', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT004', name: 'Cơ sở dữ liệu', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT005', name: 'Nhập môn Mạng máy tính', credits: 4, group: 'Cơ sở ngành' },
    { code: 'IT006', name: 'Kiến trúc máy tính', credits: 3, group: 'Cơ sở ngành' },
    { code: 'IT007', name: 'Hệ điều hành', credits: 4, group: 'Cơ sở ngành' },
    { code: 'NT016', name: 'Giới thiệu ngành MMT&TTDL', credits: 1, group: 'Cơ sở ngành' },
    { name: 'An toàn Mạng máy tính', group: 'Cơ sở ngành' },
    { name: 'Hệ thống nhúng mạng không dây', group: 'Cơ sở ngành' },
    { name: 'Truyền dữ liệu', group: 'Cơ sở ngành' },
    { name: 'Lập trình mạng căn bản', group: 'Cơ sở ngành' },
    { name: 'Phát triển ứng dụng trên thiết bị di động', group: 'Cơ sở ngành' },
    { name: 'Quản trị mạng và hệ thống', group: 'Cơ sở ngành' },
    { name: 'Thiết kế mạng', group: 'Cơ sở ngành' },
    { name: 'Đánh giá hiệu năng hệ thống mạng máy tính', group: 'Chuyên ngành' },
    { name: 'Công nghệ Internet of Things hiện đại', group: 'Chuyên ngành' },
    { name: 'Hệ tính toán phân bố', group: 'Chuyên ngành' },
    { name: 'Công nghệ truyền thông đa phương tiện', group: 'Chuyên ngành' },
    { name: 'Công nghệ mạng viễn thông', group: 'Chuyên ngành' },
    { name: 'Giải thuật xử lý song song và phân bố', group: 'Chuyên ngành' },
    { name: 'Mạng không dây thế hệ mới', group: 'Chuyên ngành' },
    { name: 'Lập trình kịch bản tự động hóa cho quản trị và bảo mật mạng', group: 'Chuyên ngành' },
    { name: 'Tín hiệu và hệ thống thông tin', group: 'Chuyên ngành' },
    { name: 'Bảo mật Internet of Things', group: 'Chuyên ngành' },
    { name: 'Thiết kế hệ thống viễn thông', group: 'Chuyên ngành' },
    { name: 'Thiết kế và triển khai mạng tốc độ cao', group: 'Chuyên ngành' },
    { name: 'Lập trình hệ thống', group: 'Chuyên ngành' },
  ],
};

const COURSE_TERM_BY_CODE = new Map<string, number>([
  ['ENG01', 1],
  ['IT001', 1],
  ['MA003', 1],
  ['MA006', 1],
  ['PH002', 1],
  ['SS004', 1],
  ['NT015', 1],
  ['NT016', 1],
  ['IT003', 2],
  ['IT005', 2],
  ['IT006', 2],
  ['MA004', 2],
  ['MA005', 2],
  ['SS003', 2],
  ['SS006', 2],
  ['IT002', 3],
  ['IT004', 3],
  ['IT007', 3],
  ['SS007', 3],
  ['NT209', 3],
  ['NT219', 3],
]);

const COURSE_CREDITS_BY_CODE = new Map<string, number>([
  ['ENG01', 4],
  ['ENG02', 4],
  ['ENG03', 4],
  ['IT001', 4],
  ['IT002', 4],
  ['IT003', 4],
  ['IT004', 4],
  ['IT005', 4],
  ['IT006', 3],
  ['IT007', 4],
  ['MA003', 3],
  ['MA004', 4],
  ['MA005', 3],
  ['MA006', 4],
  ['PH002', 4],
  ['SS003', 2],
  ['SS004', 2],
  ['SS006', 2],
  ['SS007', 3],
  ['NT015', 1],
  ['NT016', 1],
  ['NT101', 4],
  ['NT102', 4],
  ['NT103', 4],
  ['NT104', 3],
  ['NT105', 3],
  ['NT106', 3],
  ['NT201', 3],
  ['NT202', 3],
  ['NT203', 3],
  ['NT204', 3],
  ['NT205', 3],
  ['NT206', 3],
  ['NT207', 3],
  ['NT208', 3],
  ['NT209', 3],
  ['NT210', 3],
  ['NT211', 2],
  ['NT212', 2],
  ['NT219', 3],
  ['MMT201', 3],
  ['MMT202', 4],
  ['MMT203', 4],
  ['MMT204', 3],
  ['MMT205', 3],
  ['MMT301', 3],
  ['MMT302', 3],
  ['MMT303', 3],
  ['MMT304', 3],
  ['MMT305', 3],
  ['MMT306', 3],
  ['MMT307', 3],
  ['MMT308', 3],
  ['MMT309', 3],
  ['MMT310', 3],
  ['MMT311', 3],
  ['MMT312', 2],
  ['MMT313', 2],
  ['PRJ401', 4],
  ['INT401', 4],
  ['GRD401', 6],
]);

const COURSE_TERM_BY_NAME = new Map<string, number>(
  [
    ['Anh văn 2', 4],
    ['Anh văn 3', 4],
    ['An toàn mạng', 4],
    ['Quản trị mạng và hệ thống', 4],
    ['Lập trình mạng căn bản', 4],
    ['An toàn Mạng máy tính', 4],
    ['Hệ thống nhúng mạng không dây', 4],
    ['Truyền dữ liệu', 3],
    ['Thiết kế mạng', 4],
    ['Cơ chế hoạt động của mã độc', 5],
    ['Lập trình ứng dụng Web', 5],
    ['Lập trình an toàn và khai thác lỗ hổng phần mềm', 5],
    ['Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập', 5],
    ['An toàn mạng không dây và di động', 5],
    ['Quản lý rủi ro và an toàn thông tin trong doanh nghiệp', 5],
    ['Kỹ thuật phân tích mã độc', 6],
    ['Bảo mật web và ứng dụng', 6],
    ['Pháp chứng kỹ thuật số', 6],
    ['An toàn mạng máy tính nâng cao', 6],
    ['Bảo mật Internet of things', 6],
    ['Bảo mật Internet of Things', 6],
    ['An ninh nhân sự, định danh và chứng thực', 7],
    ['An toàn dữ liệu, khôi phục thông tin sau sự cố', 7],
    ['An toàn kiến trúc hệ thống', 7],
    ['Đánh giá hiệu năng hệ thống mạng máy tính', 5],
    ['Công nghệ Internet of Things hiện đại', 5],
    ['Hệ tính toán phân bố', 5],
    ['Phát triển ứng dụng trên thiết bị di động', 5],
    ['Công nghệ truyền thông đa phương tiện', 5],
    ['Công nghệ mạng viễn thông', 6],
    ['Giải thuật xử lý song song và phân bố', 6],
    ['Mạng không dây thế hệ mới', 6],
    ['Lập trình kịch bản tự động hóa cho quản trị và bảo mật mạng', 6],
    ['Tín hiệu và hệ thống thông tin', 7],
    ['Thiết kế hệ thống viễn thông', 7],
    ['Thiết kế và triển khai mạng tốc độ cao', 7],
    ['Đồ án chuyên ngành', 8],
    ['Thực tập doanh nghiệp', 8],
    ['Khóa luận/Chuyên đề tốt nghiệp', 8],
  ].map(([name, term]) => [normalizeText(String(name)), Number(term)]),
);

const COURSE_CREDITS_BY_NAME = new Map<string, number>(
  [
    ['Anh văn 1', 4],
    ['Anh văn 2', 4],
    ['Anh văn 3', 4],
    ['Tư tưởng Hồ Chí Minh', 2],
    ['Pháp luật đại cương', 2],
    ['Triết học Mác - Lênin', 3],
    ['Kỹ năng nghề nghiệp', 2],
    ['Giới thiệu ngành MMT&TTDL', 1],
    ['Giới thiệu ngành ATTT', 1],
    ['Lập trình mạng căn bản', 4],
    ['Cơ chế hoạt động của mã độc', 3],
    ['An toàn mạng', 4],
    ['Quản trị mạng và hệ thống', 4],
    ['Lập trình ứng dụng Web', 3],
    ['Lập trình an toàn và khai thác lỗ hổng phần mềm', 3],
    ['Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập', 3],
    ['An toàn mạng không dây và di động', 3],
    ['Quản lý rủi ro và an toàn thông tin trong doanh nghiệp', 3],
    ['Kỹ thuật phân tích mã độc', 3],
    ['Bảo mật web và ứng dụng', 3],
    ['Pháp chứng kỹ thuật số', 3],
    ['An toàn mạng máy tính nâng cao', 3],
    ['Bảo mật Internet of things', 3],
    ['Bảo mật Internet of Things', 3],
    ['An ninh nhân sự, định danh và chứng thực', 3],
    ['An toàn dữ liệu, khôi phục thông tin sau sự cố', 2],
    ['An toàn kiến trúc hệ thống', 2],
    ['An toàn Mạng máy tính', 4],
    ['Hệ thống nhúng mạng không dây', 3],
    ['Truyền dữ liệu', 4],
    ['Thiết kế mạng', 3],
    ['Đánh giá hiệu năng hệ thống mạng máy tính', 3],
    ['Công nghệ Internet of Things hiện đại', 3],
    ['Hệ tính toán phân bố', 3],
    ['Phát triển ứng dụng trên thiết bị di động', 3],
    ['Công nghệ truyền thông đa phương tiện', 3],
    ['Công nghệ mạng viễn thông', 3],
    ['Giải thuật xử lý song song và phân bố', 3],
    ['Mạng không dây thế hệ mới', 3],
    ['Lập trình kịch bản tự động hóa cho quản trị và bảo mật mạng', 3],
    ['Tín hiệu và hệ thống thông tin', 3],
    ['Thiết kế hệ thống viễn thông', 2],
    ['Thiết kế và triển khai mạng tốc độ cao', 2],
    ['Đồ án chuyên ngành', 4],
    ['Thực tập doanh nghiệp', 4],
    ['Khóa luận/Chuyên đề tốt nghiệp', 6],
  ].map(([name, credits]) => [normalizeText(String(name)), Number(credits)]),
);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function courseTerm(course: CurriculumCourse): number | undefined {
  if (course.term) return course.term;
  if (course.code && COURSE_TERM_BY_CODE.has(course.code.toUpperCase())) {
    return COURSE_TERM_BY_CODE.get(course.code.toUpperCase());
  }
  return COURSE_TERM_BY_NAME.get(normalizeText(course.name));
}

function courseCredits(course: CurriculumCourse): number {
  if (course.credits) return course.credits;
  if (course.code && COURSE_CREDITS_BY_CODE.has(course.code.toUpperCase())) {
    return COURSE_CREDITS_BY_CODE.get(course.code.toUpperCase()) ?? 0;
  }
  return COURSE_CREDITS_BY_NAME.get(normalizeText(course.name)) ?? 0;
}

function standardCumulativeCredits(curriculum: Curriculum | null, termIndex: number): number {
  if (!curriculum?.timelineAvailable) return 0;
  return curriculum.courses.reduce((sum, course) => {
    const plannedTerm = courseTerm(course);
    if (plannedTerm == null || plannedTerm > termIndex) return sum;
    return sum + courseCredits(course);
  }, 0);
}

function termOrder(termCode: string): number {
  const matched = termCode.match(/\d+/);
  return matched ? Number(matched[0]) : Number.MAX_SAFE_INTEGER;
}

function identifyProgram(classCode: string): AcademicProgressReport['identification'] {
  if (/^ATTN20\d{2}$/i.test(classCode)) {
    return {
      program: 'ATTT',
      programName: 'An toàn thông tin',
      trainingSystem: 'Tài năng',
      evidence: `Mã lớp ${classCode} khớp mẫu ATTN20xx của ngành ATTT hệ Tài năng.`,
    };
  }

  if (/^ATTT20\d{2}(?:\.\d+)?$/i.test(classCode)) {
    return {
      program: 'ATTT',
      programName: 'An toàn thông tin',
      trainingSystem: 'Đại trà',
      evidence: `Mã lớp ${classCode} khớp mẫu ATTT20xx(.nhóm) của ngành ATTT hệ Đại trà.`,
    };
  }

  if (/^(?:MMTT|MMT&TT)20\d{2}(?:\.\d+)?$/i.test(classCode)) {
    return {
      program: 'MMTTTDL',
      programName: 'Mạng máy tính và Truyền thông dữ liệu',
      trainingSystem: 'Đại trà',
      evidence: `Mã lớp ${classCode} khớp mẫu MMT&TT20xx(.nhóm) của ngành MMT&TTDL hệ Đại trà.`,
    };
  }

  return {
    program: 'UNKNOWN',
    programName: 'Không xác định',
    trainingSystem: 'Không xác định',
    evidence: `Mã lớp ${classCode} không khớp các mẫu ATTN20xx, ATTT20xx(.nhóm) hoặc MMT&TT20xx(.nhóm) trong policy.`,
  };
}

function getCurriculum(program: ProgramCode): Curriculum | null {
  if (program === 'ATTT') return ATTT_CURRICULUM;
  if (program === 'MMTTTDL') return MMT_CURRICULUM;
  return null;
}

function isPassedByPolicy(row: EnrollmentRow): boolean {
  const letter = row.letter_grade.toUpperCase();
  if (['MIEN', 'MIỄN', 'EXEMPT'].includes(letter)) {
    return true;
  }
  return letter !== 'F' && Number(row.final_score) >= 5;
}

function isFailedByPolicy(row: EnrollmentRow): boolean {
  const letter = row.letter_grade.toUpperCase();
  if (['MIEN', 'MIỄN', 'EXEMPT'].includes(letter)) {
    return false;
  }
  return letter === 'F' || Number(row.final_score) < 5;
}

function isCourseTaken(course: CurriculumCourse, takenCodes: Set<string>, takenNames: Set<string>): boolean {
  if (course.code && takenCodes.has(course.code.toUpperCase())) return true;
  return takenNames.has(normalizeText(course.name));
}

function buildSuggestedCourses(
  curriculum: Curriculum | null,
  enrollments: EnrollmentRow[],
  currentTermIndex: number,
): CurriculumCourse[] {
  if (!curriculum) return [];
  const takenCodes = new Set(enrollments.map((row) => row.course_code.toUpperCase()));
  const takenNames = new Set(enrollments.map((row) => normalizeText(row.course_name)));

  const untaken = curriculum.courses
    .filter((course) => !isCourseTaken(course, takenCodes, takenNames))
    .filter((course) => ['Cơ sở ngành', 'Chuyên ngành'].includes(course.group))
    .sort((left, right) => (courseTerm(left) ?? 99) - (courseTerm(right) ?? 99));

  const currentTermCourses = untaken.filter((course) => courseTerm(course) === currentTermIndex);
  const catchUpCourses = untaken.filter((course) => (courseTerm(course) ?? 99) < currentTermIndex);
  const nextCourses = untaken.filter((course) => (courseTerm(course) ?? 99) > currentTermIndex);

  return [...catchUpCourses, ...currentTermCourses, ...nextCourses]
    .slice(0, 8);
}

export async function buildAcademicProgressReport(mssv: string): Promise<AcademicProgressReport | null> {
  const studentRs = await pool.query<{
    id: string;
    mssv: string;
    full_name: string;
    class_code: string;
  }>(
    `
      SELECT s.id, s.mssv, s.full_name, c.class_code
      FROM students s
      JOIN classes c ON c.id = s.class_id
      WHERE s.mssv = $1
    `,
    [mssv],
  );

  if (studentRs.rowCount === 0) {
    return null;
  }

  const student = studentRs.rows[0];
  const identification = identifyProgram(student.class_code);
  const curriculum = getCurriculum(identification.program);

  const enrollmentRs = await pool.query<EnrollmentRow>(
    `
      SELECT
        t.term_code,
        t.term_name,
        t.start_date::text,
        c.course_code,
        c.course_name,
        c.credits,
        e.final_score::float8 AS final_score,
        e.letter_grade
      FROM enrollments e
      JOIN course_offerings co ON co.id = e.course_offering_id
      JOIN courses c ON c.id = co.course_id
      JOIN terms t ON t.id = co.term_id
      WHERE e.student_id = $1
      ORDER BY t.start_date, c.course_code
    `,
    [student.id],
  );

  const enrollments = enrollmentRs.rows;
  const termBuckets = new Map<string, { termName: string; startDate: string; rows: EnrollmentRow[] }>();
  for (const row of enrollments) {
    const bucket = termBuckets.get(row.term_code) ?? {
      termName: row.term_name,
      startDate: row.start_date,
      rows: [],
    };
    bucket.rows.push(row);
    termBuckets.set(row.term_code, bucket);
  }

  const sortedTerms = [...termBuckets.entries()].sort((left, right) => {
    const byCode = termOrder(left[0]) - termOrder(right[0]);
    if (byCode !== 0) return byCode;
    return new Date(left[1].startDate).getTime() - new Date(right[1].startDate).getTime();
  });

  let cumulativePassedCredits = 0;
  const termProgress = sortedTerms.map(([termCode, bucket], index) => {
    const registeredCredits = bucket.rows.reduce((sum, row) => sum + Number(row.credits), 0);
    const passedCredits = bucket.rows.reduce((sum, row) => sum + (isPassedByPolicy(row) ? Number(row.credits) : 0), 0);
    cumulativePassedCredits += passedCredits;

    const validRegistration = registeredCredits >= MIN_MAIN_TERM_CREDITS && registeredCredits <= MAX_MAIN_TERM_CREDITS;
    const isCurrentTerm = index === sortedTerms.length - 1;
    const standardCredits = standardCumulativeCredits(curriculum, index + 1);
    const behindStandard = Boolean(curriculum?.timelineAvailable && cumulativePassedCredits < standardCredits);
    const status: TermProgressStatus = !validRegistration
      ? isCurrentTerm
        ? 'in_progress_warning'
        : 'delayed'
      : behindStandard
        ? 'delayed'
        : 'normal';
    const reason = !validRegistration
      ? registeredCredits < MIN_MAIN_TERM_CREDITS
        ? `${isCurrentTerm ? 'Đang ghi nhận dưới' : 'Đăng ký dưới'} ${MIN_MAIN_TERM_CREDITS} tín chỉ.`
        : `Đăng ký vượt ${MAX_MAIN_TERM_CREDITS} tín chỉ.`
      : behindStandard
        ? `Lũy kế đạt ${cumulativePassedCredits} TC, thấp hơn chuẩn ${standardCredits} TC sau HK${index + 1}.`
        : curriculum?.timelineAvailable
          ? `Đăng ký hợp lệ và đạt chuẩn lũy kế ${standardCredits} TC.`
          : 'Đăng ký hợp lệ theo ngưỡng 14-30 tín chỉ. Chưa có baseline nên chưa đối chiếu chuẩn tích lũy.';

    return {
      termIndex: index + 1,
      termCode,
      termName: bucket.termName,
      registeredCredits,
      passedCredits,
      cumulativePassedCredits,
      validRegistration,
      status,
      reason,
    };
  });

  const completedMainTerms = sortedTerms.slice(0, Math.max(0, sortedTerms.length - 1));
  const completedTermCodes = new Set(completedMainTerms.map(([termCode]) => termCode));
  const courseAttempts = new Map<string, EnrollmentRow[]>();
  for (const row of enrollments.filter((item) => completedTermCodes.has(item.term_code))) {
    const key = row.course_code.toUpperCase();
    courseAttempts.set(key, [...(courseAttempts.get(key) ?? []), row]);
  }
  const failedCourses = [...courseAttempts.entries()]
    .filter(([, rows]) => rows.some(isFailedByPolicy) && !rows.some(isPassedByPolicy))
    .map(([, rows]) => rows.find(isFailedByPolicy))
    .filter((row): row is EnrollmentRow => Boolean(row))
    .map((row) => ({
      termCode: row.term_code,
      courseCode: row.course_code,
      courseName: row.course_name,
      credits: Number(row.credits),
      finalScore: Number(row.final_score),
      letterGrade: row.letter_grade,
    }));

  const currentTerm = sortedTerms[sortedTerms.length - 1];
  const currentCredits = currentTerm
    ? currentTerm[1].rows.reduce((sum, row) => sum + Number(row.credits), 0)
    : 0;
  const additionalCreditsNeeded = Math.max(0, MIN_MAIN_TERM_CREDITS - currentCredits);
  const currentTermIndex = termProgress.length;
  const suggestedCourses = buildSuggestedCourses(curriculum, enrollments, currentTermIndex);
  const takenCodes = new Set(enrollments.map((row) => row.course_code.toUpperCase()));
  const takenNames = new Set(enrollments.map((row) => normalizeText(row.course_name)));
  const missingCutoffTerm = Math.max(0, currentTermIndex - 1);
  const missingCourses =
    curriculum?.courses
      .filter((course) => {
        const plannedTerm = courseTerm(course);
        return plannedTerm != null && plannedTerm <= missingCutoffTerm && !isCourseTaken(course, takenCodes, takenNames);
      })
      .sort((left, right) => (courseTerm(left) ?? 99) - (courseTerm(right) ?? 99)) ?? [];

  return {
    student: {
      id: student.id,
      mssv: student.mssv,
      fullName: student.full_name,
      classCode: student.class_code,
    },
    identification,
    baseline: {
      totalCredits: curriculum?.totalCredits,
      timelineAvailable: Boolean(curriculum?.timelineAvailable),
      note:
        curriculum?.timelineSourceNote ??
        'Chưa xác định được ngành từ mã lớp nên không thể chọn baseline chương trình đào tạo.',
    },
    termProgress,
    failedCourses,
    missingCourses: {
      status: !curriculum ? 'unknown_program' : curriculum.timelineAvailable ? 'computed' : 'timeline_missing',
      note: !curriculum
        ? 'Không thể tính môn chưa học vì chưa xác định được ngành theo policy mã lớp.'
        : curriculum.timelineAvailable
          ? missingCourses.length
            ? 'Các môn trong baseline từ những học kỳ đã hoàn tất chưa thấy trong bảng điểm.'
            : 'Không có môn nào trong baseline của các học kỳ đã hoàn tất bị bỏ qua.'
          : 'Chưa liệt kê môn chậm theo HK1-HK3 vì sơ đồ đầu vào chưa có phân bổ HK1-HK7.',
      items: missingCourses,
    },
    currentRegistration: {
      termCode: currentTerm?.[0],
      currentCredits,
      minimumCredits: MIN_MAIN_TERM_CREDITS,
      additionalCreditsNeeded,
      recommendationNote:
        additionalCreditsNeeded > 0
          ? `Cần đăng ký thêm tối thiểu ${additionalCreditsNeeded} tín chỉ để đạt ngưỡng ${MIN_MAIN_TERM_CREDITS} tín chỉ của học kỳ chính.`
          : 'Khối lượng tín chỉ hiện tại đã đạt ngưỡng tối thiểu của học kỳ chính.',
      suggestedCourses,
    },
  };
}
