import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

type ProgramCode = 'ATTT' | 'MMT';
type TrainingSystem = 'Đại trà' | 'Tài năng';
type Profile = 'strong' | 'normal' | 'slow' | 'risky';
type AcademicStatus = 'studying' | 'delayed' | 'graduated';

type CourseSpec = {
  code: string;
  name: string;
  credits: number;
  term: number;
  programs: ProgramCode[];
  difficulty?: number;
};

type ClassSeed = {
  code: string;
  name: string;
  program: ProgramCode;
  training: TrainingSystem;
  cohort: number;
  requiredCredits: number;
  advisorIndex: number;
};

type StudentSeed = {
  mssv: string;
  fullName: string;
  classCode: string;
  classId: string;
  program: ProgramCode;
  training: TrainingSystem;
  cohort: number;
  profile: Profile;
  academicStatus: AcademicStatus;
  englishLevel: string;
};

type OfferingRow = {
  id: string;
  class_id: string;
  course_code: string;
  term_code: string;
};

type EnrollmentInsert = [
  string,
  string,
  number,
  number | null,
  number,
  string,
  boolean,
  boolean,
];

const COHORTS = [2021, 2022, 2023, 2024, 2025];
const TERMS = Array.from({ length: 9 }, (_, index) => {
  const term = index + 1;
  const academicYear = 2021 + Math.floor((term - 1) / 2);
  const isOdd = term % 2 === 1;
  return {
    code: `HK${term}`,
    name: `Học kỳ ${term}`,
    start: `${isOdd ? academicYear : academicYear + 1}-${isOdd ? '09' : '02'}-01`,
    end: `${academicYear + 1}-${isOdd ? '01' : '06'}-15`,
  };
});

const COURSES: CourseSpec[] = [
  { code: 'ENG01', name: 'Anh văn 1', credits: 4, term: 1, programs: ['ATTT', 'MMT'] },
  { code: 'IT001', name: 'Nhập môn lập trình', credits: 4, term: 1, programs: ['ATTT', 'MMT'] },
  { code: 'MA003', name: 'Đại số tuyến tính', credits: 3, term: 1, programs: ['ATTT', 'MMT'] },
  { code: 'MA006', name: 'Giải tích', credits: 4, term: 1, programs: ['ATTT', 'MMT'], difficulty: 0.4 },
  { code: 'PH002', name: 'Nhập môn mạch số', credits: 4, term: 1, programs: ['ATTT', 'MMT'], difficulty: 0.2 },
  { code: 'SS004', name: 'Kỹ năng nghề nghiệp', credits: 2, term: 1, programs: ['ATTT', 'MMT'] },
  { code: 'NT015', name: 'Giới thiệu ngành An toàn thông tin', credits: 1, term: 1, programs: ['ATTT'] },
  { code: 'NT016', name: 'Giới thiệu ngành MMT&TTDL', credits: 1, term: 1, programs: ['MMT'] },

  { code: 'IT003', name: 'Cấu trúc dữ liệu và giải thuật', credits: 4, term: 2, programs: ['ATTT', 'MMT'], difficulty: 0.35 },
  { code: 'IT005', name: 'Nhập môn mạng máy tính', credits: 4, term: 2, programs: ['ATTT', 'MMT'] },
  { code: 'IT006', name: 'Kiến trúc máy tính', credits: 3, term: 2, programs: ['ATTT', 'MMT'], difficulty: 0.15 },
  { code: 'MA004', name: 'Cấu trúc rời rạc', credits: 4, term: 2, programs: ['ATTT', 'MMT'], difficulty: 0.3 },
  { code: 'MA005', name: 'Xác suất thống kê', credits: 3, term: 2, programs: ['ATTT', 'MMT'], difficulty: 0.35 },
  { code: 'SS003', name: 'Tư tưởng Hồ Chí Minh', credits: 2, term: 2, programs: ['ATTT', 'MMT'] },
  { code: 'SS006', name: 'Pháp luật đại cương', credits: 2, term: 2, programs: ['ATTT', 'MMT'] },

  { code: 'IT002', name: 'Lập trình hướng đối tượng', credits: 4, term: 3, programs: ['ATTT', 'MMT'], difficulty: 0.25 },
  { code: 'IT004', name: 'Cơ sở dữ liệu', credits: 4, term: 3, programs: ['ATTT', 'MMT'] },
  { code: 'IT007', name: 'Hệ điều hành', credits: 4, term: 3, programs: ['ATTT', 'MMT'], difficulty: 0.45 },
  { code: 'SS007', name: 'Triết học Mác - Lênin', credits: 3, term: 3, programs: ['ATTT', 'MMT'] },
  { code: 'NT209', name: 'Lập trình hệ thống', credits: 3, term: 3, programs: ['ATTT'], difficulty: 0.35 },
  { code: 'NT219', name: 'Mật mã học', credits: 3, term: 3, programs: ['ATTT'], difficulty: 0.5 },
  { code: 'MMT201', name: 'Lập trình mạng căn bản', credits: 3, term: 3, programs: ['MMT'], difficulty: 0.25 },
  { code: 'MMT202', name: 'Truyền dữ liệu', credits: 4, term: 3, programs: ['MMT'], difficulty: 0.35 },

  { code: 'ENG02', name: 'Anh văn 2', credits: 4, term: 4, programs: ['ATTT', 'MMT'] },
  { code: 'ENG03', name: 'Anh văn 3', credits: 4, term: 4, programs: ['ATTT', 'MMT'] },
  { code: 'NT101', name: 'An toàn mạng', credits: 4, term: 4, programs: ['ATTT'], difficulty: 0.4 },
  { code: 'NT102', name: 'Quản trị mạng và hệ thống', credits: 4, term: 4, programs: ['ATTT', 'MMT'], difficulty: 0.3 },
  { code: 'NT103', name: 'Lập trình mạng căn bản', credits: 4, term: 4, programs: ['ATTT'], difficulty: 0.25 },
  { code: 'MMT203', name: 'An toàn Mạng máy tính', credits: 4, term: 4, programs: ['MMT'], difficulty: 0.35 },
  { code: 'MMT204', name: 'Hệ thống nhúng mạng không dây', credits: 3, term: 4, programs: ['MMT'], difficulty: 0.35 },
  { code: 'MMT205', name: 'Thiết kế mạng', credits: 3, term: 4, programs: ['MMT'] },

  { code: 'NT104', name: 'Cơ chế hoạt động của mã độc', credits: 3, term: 5, programs: ['ATTT'], difficulty: 0.55 },
  { code: 'NT105', name: 'Lập trình ứng dụng Web', credits: 3, term: 5, programs: ['ATTT'], difficulty: 0.2 },
  { code: 'NT106', name: 'Lập trình an toàn và khai thác lỗ hổng phần mềm', credits: 3, term: 5, programs: ['ATTT'], difficulty: 0.55 },
  { code: 'NT201', name: 'Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập', credits: 3, term: 5, programs: ['ATTT'], difficulty: 0.45 },
  { code: 'NT202', name: 'An toàn mạng không dây và di động', credits: 3, term: 5, programs: ['ATTT'], difficulty: 0.35 },
  { code: 'NT203', name: 'Quản lý rủi ro và an toàn thông tin trong doanh nghiệp', credits: 3, term: 5, programs: ['ATTT'] },
  { code: 'MMT301', name: 'Đánh giá hiệu năng hệ thống mạng máy tính', credits: 3, term: 5, programs: ['MMT'], difficulty: 0.35 },
  { code: 'MMT302', name: 'Công nghệ Internet of Things hiện đại', credits: 3, term: 5, programs: ['MMT'], difficulty: 0.25 },
  { code: 'MMT303', name: 'Hệ tính toán phân bố', credits: 3, term: 5, programs: ['MMT'], difficulty: 0.45 },
  { code: 'MMT304', name: 'Phát triển ứng dụng trên thiết bị di động', credits: 3, term: 5, programs: ['MMT'] },
  { code: 'MMT305', name: 'Công nghệ truyền thông đa phương tiện', credits: 3, term: 5, programs: ['MMT'] },

  { code: 'NT204', name: 'Kỹ thuật phân tích mã độc', credits: 3, term: 6, programs: ['ATTT'], difficulty: 0.55 },
  { code: 'NT205', name: 'Bảo mật web và ứng dụng', credits: 3, term: 6, programs: ['ATTT'], difficulty: 0.35 },
  { code: 'NT206', name: 'Pháp chứng kỹ thuật số', credits: 3, term: 6, programs: ['ATTT'], difficulty: 0.4 },
  { code: 'NT207', name: 'An toàn mạng máy tính nâng cao', credits: 3, term: 6, programs: ['ATTT'], difficulty: 0.5 },
  { code: 'NT208', name: 'Bảo mật Internet of Things', credits: 3, term: 6, programs: ['ATTT'], difficulty: 0.35 },
  { code: 'MMT306', name: 'Công nghệ mạng viễn thông', credits: 3, term: 6, programs: ['MMT'] },
  { code: 'MMT307', name: 'Giải thuật xử lý song song và phân bố', credits: 3, term: 6, programs: ['MMT'], difficulty: 0.5 },
  { code: 'MMT308', name: 'Mạng không dây thế hệ mới', credits: 3, term: 6, programs: ['MMT'] },
  { code: 'MMT309', name: 'Lập trình kịch bản tự động hóa cho quản trị và bảo mật mạng', credits: 3, term: 6, programs: ['MMT'], difficulty: 0.35 },

  { code: 'NT210', name: 'An ninh nhân sự, định danh và chứng thực', credits: 3, term: 7, programs: ['ATTT'] },
  { code: 'NT211', name: 'An toàn dữ liệu, khôi phục thông tin sau sự cố', credits: 2, term: 7, programs: ['ATTT'], difficulty: 0.25 },
  { code: 'NT212', name: 'An toàn kiến trúc hệ thống', credits: 2, term: 7, programs: ['ATTT'], difficulty: 0.3 },
  { code: 'MMT310', name: 'Tín hiệu và hệ thống thông tin', credits: 3, term: 7, programs: ['MMT'], difficulty: 0.3 },
  { code: 'MMT311', name: 'Bảo mật Internet of Things', credits: 3, term: 7, programs: ['MMT'], difficulty: 0.35 },
  { code: 'MMT312', name: 'Thiết kế hệ thống viễn thông', credits: 2, term: 7, programs: ['MMT'] },
  { code: 'MMT313', name: 'Thiết kế và triển khai mạng tốc độ cao', credits: 2, term: 7, programs: ['MMT'], difficulty: 0.25 },

  { code: 'PRJ401', name: 'Đồ án chuyên ngành', credits: 4, term: 8, programs: ['ATTT', 'MMT'], difficulty: 0.2 },
  { code: 'INT401', name: 'Thực tập doanh nghiệp', credits: 4, term: 8, programs: ['ATTT', 'MMT'] },
  { code: 'GRD401', name: 'Khóa luận/Chuyên đề tốt nghiệp', credits: 6, term: 8, programs: ['ATTT', 'MMT'], difficulty: 0.25 },
];

function grade(score: number): string {
  if (score >= 8.5) return 'A';
  if (score >= 7.0) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 5.0) return 'D';
  return 'F';
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function riskBand(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function riskQuadrant(completionRatio: number, gpa: number): string {
  if (completionRatio < 50 && gpa < 5) return 'credit_low_gpa_low';
  if (completionRatio < 50 && gpa >= 5) return 'credit_low_gpa_ok';
  if (completionRatio >= 50 && gpa < 5) return 'credit_ok_gpa_low';
  return 'safe_zone';
}

function completedTermsForCohort(cohort: number): number {
  if (cohort >= 2025) return 2;
  if (cohort === 2024) return 4;
  if (cohort === 2023) return 6;
  if (cohort === 2022) return 7;
  return 9;
}

function profileFor(mssv: string, cohort: number): Profile {
  const value = hashString(`${mssv}-profile`) % 100;
  if (cohort === 2021 && value < 24) return 'slow';
  if (value < 8) return 'risky';
  if (value < 24) return 'slow';
  if (value < 68) return 'normal';
  return 'strong';
}

function initialAcademicStatus(mssv: string, cohort: number, profile: Profile): AcademicStatus {
  const value = hashString(`${mssv}-status`) % 100;
  if (cohort === 2021 && profile !== 'risky' && value < 62) return 'graduated';
  if (cohort === 2022 && profile === 'strong' && value < 8) return 'graduated';
  if (cohort === 2021 || profile === 'slow' || profile === 'risky') return 'delayed';
  return 'studying';
}

function scoreFor(student: StudentSeed, course: CourseSpec, attemptNo: number): number {
  const base = student.profile === 'strong' ? 8.2 : student.profile === 'normal' ? 7.1 : student.profile === 'slow' ? 6.1 : 5.4;
  const trainingBonus = student.training === 'Tài năng' ? 0.35 : 0;
  const noise = ((hashString(`${student.mssv}-${course.code}-${attemptNo}`) % 31) - 15) / 10;
  const retryBonus = attemptNo > 1 ? 1.1 : 0;
  return Number(clamp(base + trainingBonus + noise + retryBonus - (course.difficulty ?? 0), 2.0, 9.8).toFixed(1));
}

function shouldFail(student: StudentSeed, course: CourseSpec): boolean {
  if (student.academicStatus === 'graduated') return false;
  const base =
    student.profile === 'risky' ? 30 : student.profile === 'slow' ? 18 : student.profile === 'normal' ? 6 : 2;
  const difficultyBoost = Math.round((course.difficulty ?? 0) * 12);
  return hashString(`${student.mssv}-${course.code}-fail`) % 100 < base + difficultyBoost;
}

function shouldSkip(student: StudentSeed, course: CourseSpec, availableTerms: number): boolean {
  if (student.academicStatus === 'graduated') return false;
  if (course.term > availableTerms) return true;
  const base =
    student.profile === 'risky' ? 24 : student.profile === 'slow' ? 16 : student.profile === 'normal' ? 5 : 2;
  const seniorBoost = student.cohort === 2021 ? 8 : 0;
  return hashString(`${student.mssv}-${course.code}-skip`) % 100 < base + seniorBoost;
}

function programRequiredCredits(program: ProgramCode): number {
  return program === 'ATTT' ? 135 : 122;
}

function makeFullName(seed: string): string {
  const lastNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Mai'];
  const middleNames = ['Minh', 'Ngọc', 'Thanh', 'Đức', 'Thu', 'Quang', 'Anh', 'Gia', 'Bảo', 'Hải', 'Khánh', 'Nhật'];
  const firstNames = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Huy', 'Khánh', 'Linh', 'Nam', 'Phương', 'Thảo', 'Vy'];
  const h = hashString(seed);
  return `${lastNames[h % lastNames.length]} ${middleNames[(h + 5) % middleNames.length]} ${firstNames[(h + 9) % firstNames.length]}`;
}

async function batchInsert(
  client: PoolClient,
  sqlPrefix: string,
  rows: unknown[][],
  columnsPerRow: number,
  batchSize = 1000,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch
      .map(
        (_, rowIndex) =>
          `(${Array.from({ length: columnsPerRow }, (__, colIndex) => `$${rowIndex * columnsPerRow + colIndex + 1}`).join(',')})`,
      )
      .join(',');
    await client.query(`${sqlPrefix} VALUES ${values}`, batch.flat());
  }
}

function buildClasses(advisorCount: number): ClassSeed[] {
  const classes: ClassSeed[] = [];
  let index = 0;
  for (const cohort of COHORTS) {
    classes.push({
      code: `ATTN${cohort}`,
      name: `An toàn thông tin Tài năng ${cohort}`,
      program: 'ATTT',
      training: 'Tài năng',
      cohort,
      requiredCredits: programRequiredCredits('ATTT'),
      advisorIndex: index % advisorCount,
    });
    index += 1;

    for (let group = 1; group <= 3; group += 1) {
      classes.push({
        code: `ATTT${cohort}.${group}`,
        name: `An toàn thông tin ${cohort}.${group}`,
        program: 'ATTT',
        training: 'Đại trà',
        cohort,
        requiredCredits: programRequiredCredits('ATTT'),
        advisorIndex: index % advisorCount,
      });
      index += 1;
    }

    for (let group = 1; group <= 4; group += 1) {
      classes.push({
        code: `MMT&TT${cohort}.${group}`,
        name: `Mạng máy tính & Truyền thông dữ liệu ${cohort}.${group}`,
        program: 'MMT',
        training: 'Đại trà',
        cohort,
        requiredCredits: programRequiredCredits('MMT'),
        advisorIndex: index % advisorCount,
      });
      index += 1;
    }
  }
  return classes;
}

function makeMssv(classSeed: ClassSeed, index: number): string {
  const yy = String(classSeed.cohort).slice(-2);
  const programPart = classSeed.program === 'ATTT' ? (classSeed.training === 'Tài năng' ? 'AN' : 'AT') : 'MM';
  const codeParts = classSeed.code.split('.');
  const groupPart = classSeed.training === 'Tài năng' ? 'T' : codeParts[codeParts.length - 1] ?? '1';
  return `${yy}${programPart}${groupPart}${String(index).padStart(3, '0')}`;
}

function buildStudents(classRows: Array<ClassSeed & { id: string }>): StudentSeed[] {
  const students: StudentSeed[] = [];
  for (const classSeed of classRows) {
    const count = classSeed.training === 'Tài năng' ? 30 : 70;
    for (let index = 1; index <= count; index += 1) {
      if (classSeed.code === 'ATTN2024' && index === 1) {
        students.push({
          mssv: '24520349',
          fullName: 'Phan Lâm Dũng',
          classCode: classSeed.code,
          classId: classSeed.id,
          program: classSeed.program,
          training: classSeed.training,
          cohort: classSeed.cohort,
          profile: 'normal',
          academicStatus: 'studying',
          englishLevel: 'Miễn',
        });
        continue;
      }

      const mssv = makeMssv(classSeed, index);
      const profile = profileFor(mssv, classSeed.cohort);
      students.push({
        mssv,
        fullName: makeFullName(`${classSeed.code}-${index}`),
        classCode: classSeed.code,
        classId: classSeed.id,
        program: classSeed.program,
        training: classSeed.training,
        cohort: classSeed.cohort,
        profile,
        academicStatus: initialAcademicStatus(mssv, classSeed.cohort, profile),
        englishLevel: hashString(`${mssv}-eng`) % 3 === 0 ? 'B1' : 'A2',
      });
    }
  }
  return students;
}

function buildEnrollmentRows(
  students: Array<StudentSeed & { id: string }>,
  offeringByKey: Map<string, string>,
): EnrollmentInsert[] {
  const rows: EnrollmentInsert[] = [];
  const exactTranscript = new Map(
    [
      ['ENG01', 9],
      ['IT001', 9],
      ['MA003', 5.8],
      ['MA006', 7],
      ['NT015', 9.3],
      ['PH002', 8.1],
      ['SS004', 8],
      ['IT003', 9.2],
      ['IT005', 8.8],
      ['IT006', 7.8],
      ['MA004', 9],
      ['MA005', 8.5],
      ['SS003', 6.5],
      ['SS006', 7.5],
      ['IT002', 6],
      ['IT004', 8.8],
      ['IT007', 7.8],
      ['NT209', 7.3],
      ['NT219', 8.3],
      ['SS007', 7],
      ['ENG02', 10],
      ['ENG03', 10],
    ] as Array<[string, number]>,
  );

  for (const student of students) {
    const availableTerms = completedTermsForCohort(student.cohort);
    const programCourses = COURSES.filter((course) => course.programs.includes(student.program));

    if (student.mssv === '24520349') {
      for (const [courseCode, score] of exactTranscript.entries()) {
        const course = COURSES.find((item) => item.code === courseCode);
        if (!course) continue;
        const offeringTerm = courseCode === 'ENG02' || courseCode === 'ENG03' ? 4 : course.term;
        const offeringId = offeringByKey.get(`${student.classId}:${courseCode}:HK${offeringTerm}`);
        if (!offeringId) continue;
        const exempt = courseCode === 'ENG02' || courseCode === 'ENG03';
        rows.push([
          student.id,
          offeringId,
          1,
          exempt ? null : score,
          score,
          exempt ? 'MIEN' : grade(score),
          true,
          false,
        ]);
      }
      continue;
    }

    const fastTrack = student.academicStatus === 'graduated' && student.cohort === 2022;
    const maxCourseTerm = student.academicStatus === 'graduated' ? 8 : Math.min(availableTerms, 8);

    for (const course of programCourses) {
      if (course.term > maxCourseTerm && !fastTrack) continue;
      if (shouldSkip(student, course, maxCourseTerm)) continue;

      const plannedTerm = fastTrack && course.term === 8 ? 7 : Math.min(course.term, availableTerms);
      const offeringId = offeringByKey.get(`${student.classId}:${course.code}:HK${plannedTerm}`);
      if (!offeringId) continue;

      const failedFirst = shouldFail(student, course);
      if (failedFirst) {
        const failScore = Number((2.8 + (hashString(`${student.mssv}-${course.code}-bad`) % 20) / 10).toFixed(1));
        rows.push([student.id, offeringId, 1, failScore, failScore, 'F', false, false]);

        const canRetake = plannedTerm + 1 <= availableTerms && hashString(`${student.mssv}-${course.code}-retake`) % 100 < 58;
        if (canRetake) {
          const retakeTerm = Math.min(plannedTerm + 1, 9);
          const retakeOffering = offeringByKey.get(`${student.classId}:${course.code}:HK${retakeTerm}`);
          if (retakeOffering) {
            const retakeScore = Number(clamp(scoreFor(student, course, 2), 5.0, 8.8).toFixed(1));
            rows.push([student.id, retakeOffering, 2, retakeScore, retakeScore, grade(retakeScore), true, true]);
          }
        }
        continue;
      }

      const score = scoreFor(student, course, 1);
      const passed = score >= 5;
      rows.push([student.id, offeringId, 1, score, score, grade(score), passed, false]);
    }
  }

  return rows;
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
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
    `);

    const adminHash = await bcrypt.hash('admin123', 10);
    const advisorHash = await bcrypt.hash('advisor123', 10);

    const dean = await client.query<{ id: string }>(
      `
        INSERT INTO users (username, password_hash, role, full_name, email)
        VALUES ('dean_admin', $1, 'DEAN_ADMIN', 'Quản trị khoa', 'dean@cvht.local')
        RETURNING id
      `,
      [adminHash],
    );

    const advisorUsers: Array<{ id: string; username: string }> = [];
    for (let index = 1; index <= 12; index += 1) {
      const rs = await client.query<{ id: string }>(
        `
          INSERT INTO users (username, password_hash, role, full_name, email)
          VALUES ($1, $2, 'ADVISOR', $3, $4)
          RETURNING id
        `,
        [`advisor_${index}`, advisorHash, `Cố vấn ${index}`, `advisor${index}@cvht.local`],
      );
      advisorUsers.push({ id: rs.rows[0].id, username: `advisor_${index}` });
    }

    await batchInsert(
      client,
      'INSERT INTO terms (term_code, term_name, start_date, end_date)',
      TERMS.map((term) => [term.code, term.name, term.start, term.end]),
      4,
    );

    await batchInsert(
      client,
      'INSERT INTO courses (course_code, course_name, credits)',
      COURSES.map((course) => [course.code, course.name, course.credits]),
      3,
    );

    const classSeeds = buildClasses(advisorUsers.length);
    await batchInsert(
      client,
      'INSERT INTO classes (class_code, class_name, advisor_user_id, required_credits)',
      classSeeds.map((classSeed) => [
        classSeed.code,
        classSeed.name,
        advisorUsers[classSeed.advisorIndex].id,
        classSeed.requiredCredits,
      ]),
      4,
    );

    const classRows = await client.query<{ id: string; class_code: string }>(
      'SELECT id, class_code FROM classes ORDER BY class_code',
    );
    const classRowsWithMeta = classSeeds.map((classSeed) => ({
      ...classSeed,
      id: classRows.rows.find((row) => row.class_code === classSeed.code)?.id ?? '',
    }));

    const students = buildStudents(classRowsWithMeta);
    await batchInsert(
      client,
      `
        INSERT INTO students (
          mssv,
          full_name,
          class_id,
          current_gpa,
          english_level,
          cohort_year,
          program_code,
          training_system,
          academic_status
        )
      `,
      students.map((student) => [
        student.mssv,
        student.fullName,
        student.classId,
        0,
        student.englishLevel,
        student.cohort,
        student.program,
        student.training,
        student.academicStatus,
      ]),
      9,
      500,
    );

    const dbStudents = await client.query<{
      id: string;
      mssv: string;
      class_id: string;
    }>('SELECT id, mssv, class_id FROM students');
    const studentIdByMssv = new Map(dbStudents.rows.map((row) => [row.mssv, row.id]));
    const studentsWithIds = students.map((student) => ({
      ...student,
      id: studentIdByMssv.get(student.mssv) ?? '',
    }));

    const offeringRows: unknown[][] = [];
    for (const classSeed of classRowsWithMeta) {
      const programCourses = COURSES.filter((course) => course.programs.includes(classSeed.program));
      for (const course of programCourses) {
        for (const term of TERMS) {
          offeringRows.push([course.code, classSeed.id, term.code, `GV ${course.code}`]);
        }
      }
    }
    for (let offset = 0; offset < offeringRows.length; offset += 1000) {
      const batch = offeringRows.slice(offset, offset + 1000);
      await client.query(`
        INSERT INTO course_offerings (course_id, class_id, term_id, lecturer_name)
        SELECT c.id, cls.id, t.id, x.lecturer_name
        FROM (
          VALUES ${batch
            .map((_, index) => `($${index * 4 + 1}::text,$${index * 4 + 2}::uuid,$${index * 4 + 3}::text,$${index * 4 + 4}::text)`)
            .join(',')}
        ) AS x(course_code, class_id, term_code, lecturer_name)
        JOIN courses c ON c.course_code = x.course_code
        JOIN classes cls ON cls.id = x.class_id
        JOIN terms t ON t.term_code = x.term_code
      `, batch.flat());
    }

    const offerings = await client.query<OfferingRow>(`
      SELECT co.id, co.class_id, c.course_code, t.term_code
      FROM course_offerings co
      JOIN courses c ON c.id = co.course_id
      JOIN terms t ON t.id = co.term_id
    `);
    const offeringByKey = new Map(
      offerings.rows.map((offering) => [
        `${offering.class_id}:${offering.course_code}:${offering.term_code}`,
        offering.id,
      ]),
    );

    const enrollmentRows = buildEnrollmentRows(studentsWithIds, offeringByKey);
    await batchInsert(
      client,
      `
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
      `,
      enrollmentRows,
      8,
      1000,
    );

    await client.query(`
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
    `);
    await client.query("UPDATE students SET current_gpa = 7.97 WHERE mssv = '24520349'");

    const riskRows = await client.query<{
      student_id: string;
      mssv: string;
      current_gpa: string;
      required_credits: number;
      completed_credits: string;
      debt_credits: string;
      failed_courses: string;
      low_score_courses: string;
      academic_status: string;
    }>(`
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
        s.current_gpa::text,
        cl.required_credits,
        COALESCE(SUM(CASE WHEN cs.has_passed THEN cs.credits ELSE 0 END), 0)::text AS completed_credits,
        COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN cs.credits ELSE 0 END), 0)::text AS debt_credits,
        COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN 1 ELSE 0 END), 0)::text AS failed_courses,
        COALESCE(SUM(CASE WHEN cs.min_score < 5 THEN 1 ELSE 0 END), 0)::text AS low_score_courses,
        s.academic_status
      FROM students s
      JOIN classes cl ON cl.id = s.class_id
      LEFT JOIN course_state cs ON cs.student_id = s.id
      GROUP BY s.id, s.mssv, s.current_gpa, cl.required_credits, s.academic_status
    `);

    for (const row of riskRows.rows) {
      const gpa = Number(row.current_gpa);
      const completed = Number(row.completed_credits);
      const debtCredits = Number(row.debt_credits);
      const failed = Number(row.failed_courses);
      const low = Number(row.low_score_courses);
      const completionRatio = row.required_credits > 0 ? (completed / row.required_credits) * 100 : 0;

      let delayRiskScore = row.academic_status === 'graduated' ? 3 : 10;
      delayRiskScore += Math.max(0, 5.5 - gpa) * 12;
      delayRiskScore += Math.max(0, 70 - completionRatio) * 0.45;
      delayRiskScore += debtCredits * 0.9;
      delayRiskScore += failed * 3.5;
      delayRiskScore += low * 1.6;
      delayRiskScore = Number(clamp(delayRiskScore, 1, 98).toFixed(1));

      const band = riskBand(delayRiskScore);
      const quadrant = riskQuadrant(completionRatio, gpa);
      const recommendation =
        row.academic_status === 'graduated'
          ? 'Đã tốt nghiệp, lưu hồ sơ theo dõi cựu sinh viên'
          : band === 'critical'
            ? 'Hẹn gặp trong 7 ngày, lập kế hoạch trả nợ môn và theo dõi hằng tuần'
            : band === 'high'
              ? 'Hẹn gặp trong 14 ngày, ưu tiên môn nợ và bổ sung kế hoạch đăng ký'
              : band === 'medium'
                ? 'Theo dõi định kỳ mỗi 3 tuần, ưu tiên các môn nền tảng'
                : 'Duy trì ổn định và theo dõi học tập định kỳ';

      await client.query(
        `
          INSERT INTO risk_snapshots (
            student_id,
            delay_risk_score,
            risk_band,
            quadrant,
            recommended_action,
            generated_by
          )
          VALUES ($1, $2, $3, $4, $5, 'SEED')
        `,
        [row.student_id, delayRiskScore, band, quadrant, recommendation],
      );

      if (row.academic_status !== 'graduated' && (band === 'high' || band === 'critical')) {
        await client.query(
          `
            INSERT INTO alerts (student_id, alert_type, severity, message, source)
            VALUES ($1, 'DELAY_RISK', $2, $3, 'SEED')
          `,
          [row.student_id, band === 'critical' ? 'critical' : 'high', `Sinh viên ${row.mssv} có nguy cơ chậm tiến độ`],
        );
      }
    }

    const classSummary = await client.query<{
      class_id: string;
      class_code: string;
      high_risk_count: string;
      avg_score: string;
    }>(`
      SELECT
        c.id AS class_id,
        c.class_code,
        SUM(CASE WHEN rs.risk_band IN ('high', 'critical') THEN 1 ELSE 0 END)::text AS high_risk_count,
        ROUND(AVG(s.current_gpa)::numeric, 2)::text AS avg_score
      FROM classes c
      JOIN students s ON s.class_id = c.id
      LEFT JOIN risk_snapshots rs ON rs.student_id = s.id
      GROUP BY c.id, c.class_code
    `);

    for (const row of classSummary.rows) {
      const highRisk = Number(row.high_risk_count);
      const priority = highRisk >= 18 ? 'critical' : highRisk >= 8 ? 'high' : 'normal';
      await client.query(
        `
          INSERT INTO ai_briefs (class_id, title, summary, priority)
          VALUES ($1, $2, $3, $4)
        `,
        [
          row.class_id,
          `Bản tin lớp ${row.class_code}`,
          `Lớp ${row.class_code} có ${highRisk} sinh viên rủi ro cao/nguy cấp, GPA trung bình ${row.avg_score}`,
          priority,
        ],
      );
    }

    await client.query(`
      INSERT INTO advisory_notes (student_id, advisor_user_id, note)
      SELECT s.id, c.advisor_user_id, 'Theo dõi tiến độ học tập và ưu tiên môn nền tảng trong 2 tuần tới'
      FROM students s
      JOIN classes c ON c.id = s.class_id
      WHERE s.academic_status <> 'graduated'
      ORDER BY s.mssv
      LIMIT 80
    `);

    await client.query(
      `
        INSERT INTO import_jobs (source_name, status, records_processed, created_by, started_at, finished_at)
        VALUES ('seed_uit_programs_2021_2025', 'success', $1, 'seed', NOW(), NOW())
      `,
      [students.length],
    );

    await client.query('COMMIT');
    logger.info({ deanUserId: dean.rows[0].id, students: students.length }, 'Seed data completed');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Seed failed');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
