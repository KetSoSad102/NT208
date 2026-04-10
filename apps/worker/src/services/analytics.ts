import { pool } from '../db.js';

function detectDrop(values: number[]): boolean {
  if (values.length < 2) return false;
  const prev = values[values.length - 2];
  const current = values[values.length - 1];
  return prev - current > 1.5;
}

export async function runAnalytics(): Promise<void> {
  await pool.query(`DELETE FROM alerts WHERE alert_type = 'GPA_DROP'`);
  await pool.query(`DELETE FROM risk_snapshots WHERE generated_by = 'RULE'`);

  const rs = await pool.query<{ student_id: string; term_code: string; gpa: number }>(`
    SELECT s.id AS student_id, t.term_code, AVG(e.final_score) AS gpa
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN course_offerings co ON co.id = e.course_offering_id
    JOIN terms t ON t.id = co.term_id
    GROUP BY s.id, t.term_code
    ORDER BY t.term_code
  `);

  const gpaByStudent = new Map<string, number[]>();
  for (const row of rs.rows) {
    const values = gpaByStudent.get(row.student_id) ?? [];
    values.push(Number(row.gpa));
    gpaByStudent.set(row.student_id, values);
  }

  for (const [studentId, gpas] of gpaByStudent.entries()) {
    if (detectDrop(gpas)) {
      await pool.query(
        `
          INSERT INTO alerts (student_id, alert_type, severity, message, source)
          VALUES ($1, 'GPA_DROP', 'high', 'GPA giam > 1.5', 'RULE')
        `,
        [studentId],
      );
    }
  }

  const riskRows = await pool.query<{
    student_id: string;
    current_gpa: number;
    required_credits: number;
    completed_credits: number;
    failed_courses: number;
    low_score_courses: number;
  }>(`
    SELECT
      s.id AS student_id,
      COALESCE(s.current_gpa, 0)::float AS current_gpa,
      c.required_credits::float AS required_credits,
      COALESCE(SUM(CASE WHEN e.passed THEN cr.credits ELSE 0 END), 0)::float AS completed_credits,
      COALESCE(SUM(CASE WHEN e.passed = FALSE THEN 1 ELSE 0 END), 0)::int AS failed_courses,
      COALESCE(SUM(CASE WHEN e.final_score < 5 THEN 1 ELSE 0 END), 0)::int AS low_score_courses
    FROM students s
    JOIN classes c ON c.id = s.class_id
    LEFT JOIN enrollments e ON e.student_id = s.id
    LEFT JOIN course_offerings co ON co.id = e.course_offering_id
    LEFT JOIN courses cr ON cr.id = co.course_id
    GROUP BY s.id, c.required_credits
  `);

  for (const row of riskRows.rows) {
    const requiredCredits = Number(row.required_credits);
    const completedCredits = Number(row.completed_credits);
    const debtCredits = Math.max(requiredCredits - completedCredits, 0);
    const completionRatio = requiredCredits > 0 ? completedCredits / requiredCredits : 0;
    const debtRatio = requiredCredits > 0 ? debtCredits / requiredCredits : 0;
    const score = Number(
      Math.min(
        100,
        Math.max(
          0,
          Math.min(1, Math.max(0, (5 - Number(row.current_gpa)) / 5)) * 45 +
            Math.min(1, debtRatio) * 35 +
            Math.min(Number(row.failed_courses), 4) * 5 +
            Math.min(Number(row.low_score_courses), 4) * 3,
        ),
      ).toFixed(1),
    );
    const riskBand = score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'low';
    const quadrant =
      completionRatio < 0.5 && Number(row.current_gpa) < 5
        ? 'urgent'
        : completionRatio < 0.5
          ? 'credit-watch'
          : Number(row.current_gpa) < 5
            ? 'gpa-watch'
            : 'healthy';
    const action =
      score >= 75
        ? 'Hen gap ngay trong 72 gio va lap ke hoach hoc lai.'
        : Number(row.failed_courses) >= 2
          ? 'Hen co van trong 7 ngay va theo doi diem thanh phan.'
          : 'Duy tri theo doi dinh ky.';

    await pool.query(
      `
        INSERT INTO risk_snapshots (
          student_id,
          delay_risk_score,
          risk_band,
          quadrant,
          recommended_action,
          generated_by
        )
        VALUES ($1, $2, $3, $4, $5, 'RULE')
      `,
      [row.student_id, score, riskBand, quadrant, action],
    );
  }
}
