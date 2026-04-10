import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

function grade(score: number): string {
  if (score >= 8.5) return 'A';
  if (score >= 7.0) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 4.0) return 'D';
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

function seededPerformanceTier(mssv: string): 'critical' | 'high' | 'medium' | 'normal' {
  const suffix = Number(mssv.slice(-2));
  if (suffix === 1) return 'critical';
  if (suffix >= 2 && suffix <= 4) return 'high';
  if (suffix >= 5 && suffix <= 8) return 'medium';
  return 'normal';
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
    for (let i = 1; i <= 4; i += 1) {
      const rs = await client.query<{ id: string }>(
        `
          INSERT INTO users (username, password_hash, role, full_name, email)
          VALUES ($1, $2, 'ADVISOR', $3, $4)
          RETURNING id
        `,
        [`advisor_${i}`, advisorHash, `Cố vấn ${i}`, `advisor${i}@cvht.local`],
      );
      advisorUsers.push({ id: rs.rows[0].id, username: `advisor_${i}` });
    }

    const classSpecs = [
      { code: 'ATTT-K18A', name: 'An toàn thông tin K18A', advisor: 0 },
      { code: 'ATTT-K18B', name: 'An toàn thông tin K18B', advisor: 0 },
      { code: 'ATTT-K18C', name: 'An toàn thông tin K18C', advisor: 1 },
      { code: 'ATTT-K18D', name: 'An toàn thông tin K18D', advisor: 1 },
      { code: 'ATTT-K18E', name: 'An toàn thông tin K18E', advisor: 2 },
      { code: 'ATTT-K18F', name: 'An toàn thông tin K18F', advisor: 2 },
      { code: 'ATTT-K18G', name: 'An toàn thông tin K18G', advisor: 3 },
    ];

    for (const spec of classSpecs) {
      await client.query(
        `
          INSERT INTO classes (class_code, class_name, advisor_user_id, required_credits)
          VALUES ($1, $2, $3, 55)
        `,
        [spec.code, spec.name, advisorUsers[spec.advisor].id],
      );
    }

    await client.query(`
      INSERT INTO terms (term_code, term_name, start_date, end_date)
      VALUES
        ('2024-1', 'Học kỳ 1 - Năm học 2024-2025', '2024-09-01', '2025-01-15'),
        ('2024-2', 'Học kỳ 2 - Năm học 2024-2025', '2025-02-01', '2025-06-15'),
        ('2024-3', 'Học kỳ 3 - Năm học 2024-2025', '2025-07-01', '2025-08-30')
    `);

    const courses = [
      { code: 'ENG01', name: 'Anh văn 1', credits: 3, term: '2024-1' },
      { code: 'IT001', name: 'Nhập môn lập trình', credits: 3, term: '2024-1' },
      { code: 'MA003', name: 'Đại số tuyến tính', credits: 3, term: '2024-1' },
      { code: 'MA006', name: 'Giải tích', credits: 3, term: '2024-1' },
      { code: 'NT015', name: 'Giới thiệu ngành An toàn thông tin', credits: 2, term: '2024-1' },
      { code: 'PH002', name: 'Nhập môn mạch số', credits: 3, term: '2024-1' },
      { code: 'SS004', name: 'Kỹ năng nghề nghiệp', credits: 2, term: '2024-1' },
      { code: 'IT003', name: 'Cấu trúc dữ liệu và giải thuật', credits: 3, term: '2024-2' },
      { code: 'IT005', name: 'Nhập môn mạng máy tính', credits: 3, term: '2024-2' },
      { code: 'IT006', name: 'Kiến trúc máy tính', credits: 3, term: '2024-2' },
      { code: 'MA004', name: 'Cấu trúc rời rạc', credits: 3, term: '2024-2' },
      { code: 'MA005', name: 'Xác suất thống kê', credits: 3, term: '2024-2' },
      { code: 'SS003', name: 'Tư tưởng Hồ Chí Minh', credits: 2, term: '2024-2' },
      { code: 'SS006', name: 'Pháp luật đại cương', credits: 2, term: '2024-2' },
      { code: 'IT002', name: 'Lập trình hướng đối tượng', credits: 3, term: '2024-3' },
      { code: 'IT004', name: 'Cơ sở dữ liệu', credits: 3, term: '2024-3' },
      { code: 'IT007', name: 'Hệ điều hành', credits: 3, term: '2024-3' },
      { code: 'NT209', name: 'Lập trình hệ thống', credits: 3, term: '2024-3' },
      { code: 'NT219', name: 'Mật mã học', credits: 3, term: '2024-3' },
      { code: 'SS007', name: 'Triết học Mác - Lênin', credits: 2, term: '2024-3' },
    ];

    await client.query(
      `
        INSERT INTO courses (course_code, course_name, credits)
        VALUES ${courses.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',')}
      `,
      courses.flatMap((c) => [c.code, c.name, c.credits]),
    );

    const classRows = await client.query<{ id: string; class_code: string }>(
      'SELECT id, class_code FROM classes ORDER BY class_code',
    );

    const lastNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ'];
    const middleNames = ['Minh', 'Ngọc', 'Thanh', 'Đức', 'Thu', 'Quang', 'Anh', 'Gia', 'Bảo', 'Hải'];
    const firstNames = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Huy', 'Khánh', 'Linh', 'Nam', 'Phương'];

    let serial = 1;
    for (const classRow of classRows.rows) {
      for (let i = 1; i <= 30; i += 1) {
        const mssv = `AT24${classRow.class_code.slice(-1)}${String(i).padStart(2, '0')}`;
        const h = hashString(`${classRow.class_code}-${i}-${serial}`);
        const fullName = `${lastNames[h % lastNames.length]} ${middleNames[(h + 3) % middleNames.length]} ${firstNames[(h + 7) % firstNames.length]}`;

        await client.query(
          `
            INSERT INTO students (mssv, full_name, class_id, current_gpa, english_level)
            VALUES ($1, $2, $3, 0, $4)
          `,
          [mssv, fullName, classRow.id, h % 2 === 0 ? 'B1' : 'A2'],
        );

        serial += 1;
      }
    }

    for (const classRow of classRows.rows) {
      for (const course of courses) {
        await client.query(
          `
            INSERT INTO course_offerings (course_id, class_id, term_id, lecturer_name)
            VALUES (
              (SELECT id FROM courses WHERE course_code = $1),
              $2,
              (SELECT id FROM terms WHERE term_code = $3),
              $4
            )
          `,
          [course.code, classRow.id, course.term, `GV ${course.code}`],
        );
      }
    }

    const offerings = await client.query<{
      id: string;
      class_id: string;
      course_code: string;
      term_code: string;
    }>(`
      SELECT co.id, co.class_id, c.course_code, t.term_code
      FROM course_offerings co
      JOIN courses c ON c.id = co.course_id
      JOIN terms t ON t.id = co.term_id
    `);

    const students = await client.query<{ id: string; mssv: string; class_id: string }>(
      'SELECT id, mssv, class_id FROM students',
    );

    const offeringByClass = new Map<string, typeof offerings.rows>();
    for (const offering of offerings.rows) {
      const arr = offeringByClass.get(offering.class_id) ?? [];
      arr.push(offering);
      offeringByClass.set(offering.class_id, arr);
    }

    const courseDifficulty: Record<string, number> = {
      IT007: -0.6,
      NT209: -0.7,
      NT219: -1.0,
      MA006: -0.5,
      MA005: -0.4,
      SS004: 0.4,
      SS003: 0.3,
      SS006: 0.3,
      SS007: 0.2,
    };

    for (const student of students.rows) {
      const items = offeringByClass.get(student.class_id) ?? [];
      const performanceTier = seededPerformanceTier(student.mssv);
      for (const item of items) {
        const ability = 5.2 + (hashString(student.mssv) % 38) / 10;
        const noise = ((hashString(`${student.mssv}-${item.course_code}`) % 21) - 10) / 10;
        const termAdjust = item.term_code === '2024-3' ? -0.15 : item.term_code === '2024-2' ? 0.1 : 0;
        const difficult = courseDifficulty[item.course_code] ?? 0;
        const tierPenalty =
          performanceTier === 'critical'
            ? 3.4
            : performanceTier === 'high'
              ? 2.2
              : performanceTier === 'medium'
                ? 0.9
                : 0;
        const hardCoursePenalty =
          performanceTier !== 'normal' && ['IT007', 'NT209', 'NT219', 'MA006', 'MA005'].includes(item.course_code)
            ? performanceTier === 'critical'
              ? 0.8
              : performanceTier === 'high'
                ? 0.5
                : 0.2
            : 0;

        const finalScore = Number(
          clamp(ability + difficult + termAdjust + noise - tierPenalty - hardCoursePenalty, 2.0, 9.8).toFixed(1),
        );
        const midterm = Number(
          clamp(finalScore + ((hashString(`${student.mssv}-mid`) % 7) - 3) / 10 - tierPenalty * 0.15, 2.0, 9.8).toFixed(
            1,
          ),
        );
        const attemptNo =
          performanceTier === 'critical'
            ? hashString(`${student.mssv}-${item.course_code}`) % 3 === 0
              ? 2
              : 1
            : performanceTier === 'high'
              ? hashString(`${student.mssv}-${item.course_code}`) % 5 === 0
                ? 2
                : 1
              : hashString(`${student.mssv}-${item.course_code}`) % 12 === 0
                ? 2
                : 1;

        await client.query(
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            student.id,
            item.id,
            attemptNo,
            midterm,
            finalScore,
            grade(finalScore),
            finalScore >= 4.0,
            attemptNo > 1,
          ],
        );
      }
    }

    await client.query(`
      UPDATE students s
      SET current_gpa = x.avg_score
      FROM (
        SELECT e.student_id, ROUND(AVG(e.final_score)::numeric, 2) AS avg_score
        FROM enrollments e
        GROUP BY e.student_id
      ) x
      WHERE x.student_id = s.id
    `);

    const riskRows = await client.query<{
      student_id: string;
      mssv: string;
      class_code: string;
      current_gpa: string;
      required_credits: number;
      completed_credits: string;
      failed_courses: string;
      low_score_courses: string;
    }>(`
      SELECT
        s.id AS student_id,
        s.mssv,
        c.class_code,
        s.current_gpa::text,
        c.required_credits,
        COALESCE(SUM(CASE WHEN e.passed THEN cr.credits ELSE 0 END), 0)::text AS completed_credits,
        SUM(CASE WHEN e.passed = false THEN 1 ELSE 0 END)::text AS failed_courses,
        SUM(CASE WHEN e.final_score < 5 THEN 1 ELSE 0 END)::text AS low_score_courses
      FROM students s
      JOIN classes c ON c.id = s.class_id
      JOIN enrollments e ON e.student_id = s.id
      JOIN course_offerings co ON co.id = e.course_offering_id
      JOIN courses cr ON cr.id = co.course_id
      GROUP BY s.id, s.mssv, c.class_code, s.current_gpa, c.required_credits
    `);

    for (const row of riskRows.rows) {
      const gpa = Number(row.current_gpa);
      const completed = Number(row.completed_credits);
      const failed = Number(row.failed_courses);
      const low = Number(row.low_score_courses);
      const completionRatio = row.required_credits > 0 ? (completed / row.required_credits) * 100 : 0;

      let delayRiskScore = 12;
      delayRiskScore += Math.max(0, 5.5 - gpa) * 12;
      delayRiskScore += Math.max(0, 55 - completionRatio) * 0.7;
      delayRiskScore += failed * 4.5;
      delayRiskScore += low * 2.2;
      delayRiskScore = Number(clamp(delayRiskScore, 5, 98).toFixed(1));

      const band = riskBand(delayRiskScore);
      const quadrant = riskQuadrant(completionRatio, gpa);
      const recommendation =
        band === 'critical'
          ? 'Hẹn gặp trong 7 ngày, lập kế hoạch học lại và theo dõi hằng tuần'
          : band === 'high'
            ? 'Hẹn gặp trong 14 ngày, bổ sung đề cương ôn tập và nhắc tiến độ'
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

      if (band === 'high' || band === 'critical') {
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
      const priority = highRisk >= 8 ? 'critical' : highRisk >= 4 ? 'high' : 'normal';
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
      ORDER BY s.mssv
      LIMIT 20
    `);

    await client.query(
      `
        INSERT INTO import_jobs (source_name, status, records_processed, created_by, started_at, finished_at)
        VALUES ('seed_bootstrap', 'success', $1, 'seed', NOW(), NOW())
      `,
      [students.rows.length],
    );

    await client.query('COMMIT');
    logger.info({ deanUserId: dean.rows[0].id }, 'Seed data completed');
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
