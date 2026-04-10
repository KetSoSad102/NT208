import { pool } from '../db/pool.js';
import type { AuthRequest } from '../middleware/auth.js';

export async function canAccessClass(req: AuthRequest, classId: string): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'DEAN_ADMIN') return true;
  if (!req.user.userId) return false;

  const result = await pool.query(
    `SELECT 1 FROM classes WHERE advisor_user_id = $1 AND id = $2 LIMIT 1`,
    [req.user.userId, classId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function canAccessStudent(req: AuthRequest, mssv: string): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'DEAN_ADMIN') return true;
  if (!req.user.userId) return false;

  const result = await pool.query(
    `
      SELECT 1
      FROM students s
      JOIN classes c ON c.id = s.class_id
      WHERE c.advisor_user_id = $1 AND s.mssv = $2
      LIMIT 1
    `,
    [req.user.userId, mssv],
  );

  return (result.rowCount ?? 0) > 0;
}
