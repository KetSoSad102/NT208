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

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      await processQueuedJobs(daaClient);
    } catch (error) {
      logger.error({ error }, 'Poll iteration failed');
    }
    await sleep(env.WORKER_POLL_SECONDS * 1000);
  }
}

async function main(): Promise<void> {
  if (env.DAA_AUTO_SYNC) {
    cron.schedule(env.DAA_SYNC_CRON, async () => {
      try {
        await pool.query(
          `
            INSERT INTO import_jobs (source_name, status, created_by)
            VALUES ($1, 'queued', 'scheduler')
          `,
          [env.DAA_CLIENT_MODE === 'real' ? 'daa_demo' : 'mock_daa'],
        );
        logger.info('Scheduled import job queued');
      } catch (error) {
        logger.error({ error }, 'Failed to enqueue scheduled import job');
      }
    });
  }

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, draining poll loop');
    shuttingDown = true;
  });
  process.on('SIGINT', () => {
    logger.info('SIGINT received, draining poll loop');
    shuttingDown = true;
  });

  logger.info(
    { mode: env.DAA_CLIENT_MODE, autoSync: env.DAA_AUTO_SYNC, cron: env.DAA_SYNC_CRON },
    'Worker started',
  );

  await pollLoop();
  await pool.end();
  logger.info('Worker stopped');
}

main().catch((error) => {
  logger.error({ error }, 'Worker failed to start');
  process.exit(1);
});
