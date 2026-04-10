import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  void _next;
  logger.error({ err }, 'Unhandled API error');
  res.status(500).json({ message: 'Internal Server Error' });
}
