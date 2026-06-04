import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_POLL_SECONDS: z.coerce.number().default(15),
  DAA_AUTO_SYNC: z
    .string()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  DAA_SYNC_CRON: z.string().default('0 23 30 6,12 *'),
  DAA_CLIENT_MODE: z.enum(['mock', 'real']).default('mock'),
  DAA_BASE_URL: z.string().default('http://api:3000'),
  DAA_API_TOKEN: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
