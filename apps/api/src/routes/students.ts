import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { canAccessStudent } from '../services/accessService.js';
import { writeAuditLog } from '../services/auditService.js';
import { buildAcademicProgressReport } from '../services/academicPolicyService.js';

const NoteSchema = z.object({
  note: z.string().min(1).max(1000),
});

export const studentsRouter = Router();

studentsRouter.use(requireAuth);

studentsRouter.get('/:mssv/dashboard', async (req: AuthRequest, res) => {
  const { mssv } = req.params;
  const allowed = await canAccessStudent(req, mssv);
  if (!allowed) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const student = await pool.query<{
    id: string;
    mssv: string;
    full_name: string;
    class_code: string;
    academic_status: string;
  }>(
    `
      SELECT s.id, s.mssv, s.full_name, c.class_code, s.academic_status
      FROM students s
      JOIN classes c ON c.id = s.class_id
      WHERE s.mssv = $1
    `,
    [mssv],
  );

  if (student.rowCount === 0) {
    res.status(404).json({ message: 'Student not found' });
    return;
  }

  const gpaTrend = await pool.query<{ term_code: string; gpa: string }>(
    `
      SELECT t.term_code, ROUND(AVG(e.final_score)::numeric, 2)::text AS gpa
      FROM enrollments e
      JOIN course_offerings co ON co.id = e.course_offering_id
      JOIN terms t ON t.id = co.term_id
      JOIN students s ON s.id = e.student_id
      WHERE s.mssv = $1
      GROUP BY t.term_code
      ORDER BY t.term_code
    `,
    [mssv],
  );

  const creditProgress = await pool.query<{ completed: string; required: string; debt: string }>(
    `
      WITH target_student AS (
        SELECT s.id, cl.required_credits
        FROM students s
        JOIN classes cl ON cl.id = s.class_id
        WHERE s.mssv = $1
      ),
      course_state AS (
        SELECT
          c.course_code,
          c.credits,
          BOOL_OR(e.passed) AS has_passed,
          BOOL_OR(e.passed = false OR e.final_score < 5) AS has_failed
        FROM target_student ts
        JOIN enrollments e ON e.student_id = ts.id
        JOIN course_offerings co ON co.id = e.course_offering_id
        JOIN courses c ON c.id = co.course_id
        GROUP BY c.course_code, c.credits
      )
      SELECT
        COALESCE(SUM(CASE WHEN cs.has_passed THEN cs.credits ELSE 0 END), 0)::text AS completed,
        MAX(ts.required_credits)::text AS required,
        COALESCE(SUM(CASE WHEN cs.has_failed AND NOT cs.has_passed THEN cs.credits ELSE 0 END), 0)::text AS debt
      FROM target_student ts
      LEFT JOIN course_state cs ON true
      GROUP BY ts.id
    `,
    [mssv],
  );

  const alerts = await pool.query('SELECT id, alert_type, severity, message, created_at FROM alerts WHERE student_id = $1 ORDER BY created_at DESC', [student.rows[0].id]);
  const notes = await pool.query('SELECT note, created_at FROM advisory_notes WHERE student_id = $1 ORDER BY created_at DESC', [student.rows[0].id]);
  const riskProfile = await pool.query<{
    delay_risk_score: string;
    risk_band: string;
    quadrant: string;
    recommended_action: string;
  }>(
    `
      SELECT delay_risk_score::text, risk_band, quadrant, recommended_action
      FROM risk_snapshots
      WHERE student_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [student.rows[0].id],
  );

  await writeAuditLog({
    userId: req.user?.userId,
    action: 'VIEW_DASHBOARD',
    resourceType: 'STUDENT',
    resourceId: mssv,
  });

  const credits = creditProgress.rows[0] ?? { completed: '0', required: '0', debt: '0' };

  res.json({
    student: student.rows[0],
    gpaTrend: gpaTrend.rows.map((r) => ({ termCode: r.term_code, gpa: Number(r.gpa) })),
    creditProgress: {
      completed: Number(credits.completed),
      required: Number(credits.required),
      debt: Number(credits.debt),
    },
    alerts: alerts.rows,
    notes: notes.rows,
    riskProfile: riskProfile.rowCount
      ? {
          delayRiskScore: Number(riskProfile.rows[0].delay_risk_score),
          riskBand: riskProfile.rows[0].risk_band,
          quadrant: riskProfile.rows[0].quadrant,
          recommendedAction: riskProfile.rows[0].recommended_action,
        }
      : null,
  });
});

studentsRouter.get('/:mssv/alerts', async (req: AuthRequest, res) => {
  const { mssv } = req.params;
  const allowed = await canAccessStudent(req, mssv);
  if (!allowed) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const rs = await pool.query(
    `
      SELECT a.id, a.alert_type, a.severity, a.message, a.created_at
      FROM alerts a
      JOIN students s ON s.id = a.student_id
      WHERE s.mssv = $1
      ORDER BY a.created_at DESC
    `,
    [mssv],
  );

  res.json(rs.rows);
});

studentsRouter.get('/:mssv/academic-progress', async (req: AuthRequest, res) => {
  const { mssv } = req.params;
  const allowed = await canAccessStudent(req, mssv);
  if (!allowed) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const report = await buildAcademicProgressReport(mssv);
  if (!report) {
    res.status(404).json({ message: 'Student not found' });
    return;
  }

  await writeAuditLog({
    userId: req.user?.userId,
    action: 'VIEW_ACADEMIC_PROGRESS',
    resourceType: 'STUDENT',
    resourceId: mssv,
  });

  res.json(report);
});

studentsRouter.post('/:mssv/notes', async (req: AuthRequest, res) => {
  const { mssv } = req.params;
  const allowed = await canAccessStudent(req, mssv);
  if (!allowed) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  if (!req.user || req.user.role !== 'ADVISOR') {
    res.status(403).json({ message: 'Only advisor can create note' });
    return;
  }

  const payload = NoteSchema.parse(req.body);
  const studentRs = await pool.query('SELECT id FROM students WHERE mssv = $1', [mssv]);
  if (studentRs.rowCount === 0) {
    res.status(404).json({ message: 'Student not found' });
    return;
  }

  const noteRs = await pool.query(
    `
      INSERT INTO advisory_notes (student_id, advisor_user_id, note)
      VALUES ($1, $2, $3)
      RETURNING id, note, created_at
    `,
    [studentRs.rows[0].id, req.user.userId, payload.note],
  );

  await writeAuditLog({
    userId: req.user.userId,
    action: 'CREATE_NOTE',
    resourceType: 'STUDENT',
    resourceId: mssv,
    metadata: { noteId: noteRs.rows[0].id },
  });

  res.status(201).json(noteRs.rows[0]);
});
