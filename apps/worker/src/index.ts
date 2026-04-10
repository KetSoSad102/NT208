import cron from 'node-cron';
import { env } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { processQueuedJobs } from './jobs/ingestionJob.js';

async function main() {
  setInterval(async () => {
    await processQueuedJobs();
  }, env.WORKER_POLL_SECONDS * 1000);

  cron.schedule(env.INGESTION_CRON, async () => {
    await pool.query(
      `
        INSERT INTO import_jobs (source_name, status, created_by)
        VALUES ('mock_daa', 'queued', 'scheduler')
      `,
    );
    logger.info('Scheduled import job queued');
  });

  logger.info('Worker started');
}

main().catch((error) => {
  logger.error({ error }, 'Worker failed to start');
  process.exit(1);
});
