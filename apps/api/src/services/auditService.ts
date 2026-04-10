import { pool } from '../db/pool.js';

export async function writeAuditLog(input: {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: unknown;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [input.userId || null, input.action, input.resourceType, input.resourceId || null, JSON.stringify(input.metadata ?? {})],
  );
}
