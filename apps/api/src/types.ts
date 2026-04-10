import type { Request } from 'express';
import type { JwtUser } from '@cvht/shared';

export interface AuthenticatedRequest extends Request {
  user: JwtUser;
}
