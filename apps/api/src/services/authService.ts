import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { signToken } from '../auth/jwt.js';

export async function login(username: string, password: string): Promise<{ accessToken: string } | null> {
  const rs = await pool.query<{
    id: string;
    role: 'DEAN_ADMIN' | 'ADVISOR';
    password_hash: string;
  }>(`SELECT id, role, password_hash FROM users WHERE username = $1`, [username]);

  const user = rs.rows[0];
  if (!user) return null;

  const matched = await bcrypt.compare(password, user.password_hash);
  if (!matched) return null;

  return {
    accessToken: signToken({
      userId: user.id,
      role: user.role,
      advisorId: user.role === 'ADVISOR' ? user.id : undefined,
    }),
  };
}
