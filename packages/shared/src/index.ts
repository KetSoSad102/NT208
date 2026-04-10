export const Roles = {
  DEAN_ADMIN: 'DEAN_ADMIN',
  ADVISOR: 'ADVISOR',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export const ImportJobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAIL: 'fail',
} as const;

export type ImportJobStatusType = (typeof ImportJobStatus)[keyof typeof ImportJobStatus];

export interface JwtUser {
  userId: string;
  role: Role;
  advisorId?: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
