import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { classesRouter } from './routes/classes.js';
import { studentsRouter } from './routes/students.js';
import { analyticsRouter } from './routes/analytics.js';
import { adminRouter } from './routes/admin.js';
import { aiRouter } from './routes/ai.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

export const app = express();
app.set('etag', false);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((pinoHttp as unknown as (opts: { logger: typeof logger }) => express.RequestHandler)({ logger }));

app.use(healthRouter);
app.use('/auth', authRouter);
app.use('/classes', classesRouter);
app.use('/students', studentsRouter);
app.use('/analytics', analyticsRouter);
app.use('/ai', aiRouter);
app.use('/admin', adminRouter);

app.use(errorHandler);
