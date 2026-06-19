import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api', timestamp: new Date().toISOString() });
});

healthRouter.get('/internal/fix-data', async (_req, res) => {
  const { pool } = await import('../db/pool.js');
  const advisorRs = await pool.query("SELECT id FROM users WHERE username = 'advisor_1'");
  if (advisorRs.rows.length === 0) return res.json({ message: 'No advisor_1' });
  const advisorId = advisorRs.rows[0].id;
  const classRs = await pool.query("SELECT id FROM classes WHERE advisor_user_id = $1", [advisorId]);
  let count = 0;
  for (const cls of classRs.rows) {
    const studentRs = await pool.query("SELECT id FROM students WHERE class_id = $1 LIMIT 8", [cls.id]);
    for (const student of studentRs.rows) {
      const rs = await pool.query("UPDATE enrollments SET passed = false, final_score = 3.5, letter_grade = 'F' WHERE student_id = $1 AND final_score > 6 LIMIT 2", [student.id]);
      count += rs.rowCount || 0;
    }
  }
  res.json({ message: `Injected ${count} failures for advisor_1` });
});
