import { pool } from '../db/pool.js';
import { detectGpaDrop, topKillerCourses } from './analyticsRules.js';

export async function calculateAndPersistAlerts(): Promise<void> {
  const students = await pool.query<{ student_id: string; term_code: string; gpa: number }>(`
    SELECT s.id AS student_id, t.term_code, AVG(e.final_score) AS gpa
    FROM students s
    JOIN enrollments e ON e.student_id = s.id
    JOIN course_offerings co ON co.id = e.course_offering_id
    JOIN terms t ON t.id = co.term_id
    GROUP BY s.id, t.term_code
  `);

  const bucket = new Map<string, Array<{ termCode: string; gpa: number }>>();
  for (const row of students.rows) {
    const arr = bucket.get(row.student_id) ?? [];
    arr.push({ termCode: row.term_code, gpa: Number(row.gpa) });
    bucket.set(row.student_id, arr);
  }

  for (const [studentId, termGPAs] of bucket.entries()) {
    if (detectGpaDrop(termGPAs)) {
      await pool.query(
        `
          INSERT INTO alerts (student_id, alert_type, severity, message)
          VALUES ($1, 'GPA_DROP', 'high', 'GPA giam hon 1.5 so voi hoc ky truoc')
        `,
        [studentId],
      );
    }
  }
}

export async function getGradeDistribution(courseOfferingId: string) {
  const rs = await pool.query<{ bin: string; count: string }>(`
    SELECT
      CASE
        WHEN e.final_score < 4 THEN '0-4'
        WHEN e.final_score < 5.5 THEN '4-5.5'
        WHEN e.final_score < 7 THEN '5.5-7'
        WHEN e.final_score < 8.5 THEN '7-8.5'
        ELSE '8.5-10'
      END AS bin,
      COUNT(*)::text AS count
    FROM enrollments e
    WHERE e.course_offering_id = $1
    GROUP BY bin
    ORDER BY bin;
  `, [courseOfferingId]);

  return rs.rows.map((r) => ({ bin: r.bin, count: Number(r.count) }));
}

export async function getClassLeaderboard() {
  const rs = await pool.query<{ class_code: string; avg_gpa: string }>(`
    SELECT c.class_code, AVG(e.final_score)::text AS avg_gpa
    FROM classes c
    JOIN students s ON s.class_id = c.id
    JOIN enrollments e ON e.student_id = s.id
    GROUP BY c.class_code
    ORDER BY AVG(e.final_score) DESC;
  `);

  return rs.rows.map((r) => ({ classCode: r.class_code, avgGpa: Number(r.avg_gpa) }));
}

export async function getTopKillerCoursesByClass(classId: string) {
  const rs = await pool.query<{ course_code: string; fail_rate: string }>(`
    SELECT c.course_code,
      AVG(CASE WHEN e.passed THEN 0 ELSE 1 END)::text AS fail_rate
    FROM course_offerings co
    JOIN courses c ON c.id = co.course_id
    JOIN enrollments e ON e.course_offering_id = co.id
    WHERE co.class_id = $1
    GROUP BY c.course_code
  `, [classId]);

  return topKillerCourses(rs.rows.map((r) => ({ courseCode: r.course_code, failRate: Number(r.fail_rate) })));
}

export async function getGraduationForecast() {
  const rs = await pool.query<{ mssv: string; completed_credits: string; required_credits: string }>(`
    SELECT s.mssv,
      COALESCE(SUM(CASE WHEN e.passed THEN c.credits ELSE 0 END), 0)::text AS completed_credits,
      cl.required_credits::text AS required_credits
    FROM students s
    LEFT JOIN enrollments e ON e.student_id = s.id
    LEFT JOIN course_offerings co ON co.id = e.course_offering_id
    LEFT JOIN courses c ON c.id = co.course_id
    JOIN classes cl ON cl.id = s.class_id
    GROUP BY s.mssv, cl.required_credits
    ORDER BY s.mssv;
  `);

  return rs.rows.map((r) => ({
    mssv: r.mssv,
    completedCredits: Number(r.completed_credits),
    requiredCredits: Number(r.required_credits),
    debtCredits: Math.max(0, Number(r.required_credits) - Number(r.completed_credits)),
  }));
}
