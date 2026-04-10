import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../../../infra/migrations');

async function run() {
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
    logger.info({ file }, 'Running migration');
    await pool.query(sql);
  }
  logger.info('Migrations completed');
  await pool.end();
}

run().catch(async (error) => {
  logger.error({ error }, 'Migration failed');
  await pool.end();
  process.exit(1);
});
