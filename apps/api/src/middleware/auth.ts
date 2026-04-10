import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../auth/jwt.js';
import { pool } from '../db/pool.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: 'DEAN_ADMIN' | 'ADVISOR';
    advisorId?: string;
  };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const token = authHeader.slice('Bearer '.length);
    const payload = verifyToken(token);
    const userRs = await pool.query<{ id: string; role: 'DEAN_ADMIN' | 'ADVISOR' }>(
      `
        SELECT id, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [payload.userId],
    );

    if ((userRs.rowCount ?? 0) === 0) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (userRs.rows[0].role !== payload.role) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    req.user = {
      userId: payload.userId,
      role: userRs.rows[0].role,
      advisorId: payload.advisorId,
    };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}
