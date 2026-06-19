import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { signToken } from '../auth/jwt.js';

export async function login(username: string, password: string): Promise<{ accessToken: string } | null> {
  const rs = await pool.query<{
    id: string;
    role: 'DEAN_ADMIN' | 'ADVISOR';
    password_hash: string;
    full_name: string;
  }>(`SELECT id, role, password_hash, full_name FROM users WHERE username = $1`, [username]);

  const user = rs.rows[0];
  if (!user) return null;

  const matched = await bcrypt.compare(password, user.password_hash);
  if (!matched) return null;

  return {
    accessToken: signToken({
      userId: user.id,
      role: user.role,
      username: user.username,
      fullName: user.full_name,
      advisorId: user.role === 'ADVISOR' ? user.id : undefined,
    }),
  };
}

export async function register(payload: {
  username: string;
  password: string;
  fullName: string;
  email?: string;
  classCode: string;
}): Promise<{ accessToken: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check if class exists
    const classRs = await client.query('SELECT id FROM classes WHERE class_code = $1', [payload.classCode]);
    if (classRs.rowCount === 0) {
      throw new Error(`Lớp ${payload.classCode} không tồn tại trên hệ thống.`);
    }
    const classId = classRs.rows[0].id;

    // 2. Create user
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const userRs = await client.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, role, full_name, email)
       VALUES ($1, $2, 'ADVISOR', $3, $4)
       RETURNING id`,
      [payload.username, passwordHash, payload.fullName, payload.email],
    );
    const userId = userRs.rows[0].id;

    // 3. Update class advisor
    await client.query('UPDATE classes SET advisor_user_id = $1 WHERE id = $2', [userId, classId]);

    await client.query('COMMIT');

    return {
      accessToken: signToken({
        userId,
        role: 'ADVISOR',
        username: payload.username,
        fullName: payload.fullName,
        advisorId: userId,
      }),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
