import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_POLL_SECONDS: z.coerce.number().default(15),
  INGESTION_CRON: z.string().default('0 1 * * *'),
});

export const env = EnvSchema.parse(process.env);
