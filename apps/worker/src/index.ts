import cron from 'node-cron';
import { env } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { processQueuedJobs } from './jobs/ingestionJob.js';
import { MockDAAClient } from './clients/MockDAAClient.js';
import { RealDAAClient } from './clients/RealDAAClient.js';

const daaClient =
  env.DAA_CLIENT_MODE === 'real'
    ? new RealDAAClient(env.DAA_BASE_URL, env.DAA_API_TOKEN)
    : new MockDAAClient();

async function main() {
  setInterval(async () => {
    await processQueuedJobs(daaClient);
  }, env.WORKER_POLL_SECONDS * 1000);

  if (env.DAA_AUTO_SYNC) {
    cron.schedule(env.DAA_SYNC_CRON, async () => {
      await pool.query(
        `
          INSERT INTO import_jobs (source_name, status, created_by)
          VALUES ($1, 'queued', 'scheduler')
        `,
        [env.DAA_CLIENT_MODE === 'real' ? 'daa_demo' : 'mock_daa'],
      );
      logger.info('Scheduled import job queued');
    });
  }

  logger.info(
    { mode: env.DAA_CLIENT_MODE, autoSync: env.DAA_AUTO_SYNC, cron: env.DAA_SYNC_CRON },
    'Worker started',
  );
}

main().catch((error) => {
  logger.error({ error }, 'Worker failed to start');
  process.exit(1);
});
