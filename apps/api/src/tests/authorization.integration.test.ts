import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/accessService.js', () => ({
  canAccessClass: vi.fn(async () => false),
  canAccessStudent: vi.fn(async () => false),
}));

describe('authorization integration', () => {
  it.skip('returns 403 when advisor accesses unauthorized class', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@localhost:5432/x';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'supersecret_supersecret';

    const { app } = await import('../app.js');
    const token = jwt.sign(
      { userId: 'u1', role: 'ADVISOR', advisorId: 'a1' },
      process.env.JWT_SECRET as string,
    );

    const res = await request(app)
      .get('/classes/11111111-1111-1111-1111-111111111111/students')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
