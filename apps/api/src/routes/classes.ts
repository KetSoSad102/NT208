import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { canAccessClass } from '../services/accessService.js';

export const classesRouter = Router();

classesRouter.use(requireAuth);

classesRouter.get('/', async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  if (req.user.role === 'DEAN_ADMIN') {
    const all = await pool.query('SELECT id, class_code, class_name FROM classes ORDER BY class_code');
    res.json(all.rows);
    return;
  }

  const rs = await pool.query(
    `
      SELECT c.id, c.class_code, c.class_name
      FROM classes c
      WHERE c.advisor_user_id = $1
      ORDER BY c.class_code
    `,
    [req.user.userId],
  );
  res.json(rs.rows);
});

classesRouter.get('/:id/students', async (req: AuthRequest, res) => {
  const classId = req.params.id;
  const allowed = await canAccessClass(req, classId);
  if (!allowed) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const rs = await pool.query(
    'SELECT id, mssv, full_name, current_gpa::float8 AS current_gpa FROM students WHERE class_id = $1 ORDER BY mssv',
    [classId],
  );

  res.json(rs.rows);
});
