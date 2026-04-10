import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  getClassLeaderboard,
  getGraduationForecast,
  getGradeDistribution,
} from '../services/analyticsService.js';

const GradeDistSchema = z.object({
  courseOfferingId: z.string().uuid(),
});

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get('/grade-distributions', async (req, res) => {
  const query = GradeDistSchema.parse(req.query);
  const data = await getGradeDistribution(query.courseOfferingId);
  res.json(data);
});

analyticsRouter.get('/graduation-forecast', async (_req, res) => {
  const data = await getGraduationForecast();
  res.json(data);
});

analyticsRouter.get('/class-leaderboard', async (_req, res) => {
  const data = await getClassLeaderboard();
  res.json(data);
});
