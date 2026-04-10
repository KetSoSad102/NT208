import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { pool } from '../db/pool.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRoles('DEAN_ADMIN'));

adminRouter.post('/import-jobs/trigger', async (req, res) => {
  const sourceName = typeof req.body?.sourceName === 'string' ? req.body.sourceName : 'mock_daa';
  const job = await pool.query(
    `
      INSERT INTO import_jobs (source_name, status, created_by)
      VALUES ($1, 'queued', 'admin')
      RETURNING id, source_name, status, created_at
    `,
    [sourceName],
  );

  res.status(201).json(job.rows[0]);
});
