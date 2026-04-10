import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'API listening');
});
