import { Router } from 'express';
import { z } from 'zod';
import { login, register } from '../services/authService.js';

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  classCode: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const payload = LoginSchema.parse(req.body);
  const result = await login(payload.username, payload.password);
  if (!result) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }
  res.json(result);
});

authRouter.post('/register', async (req, res) => {
  try {
    const payload = RegisterSchema.parse(req.body);
    const result = await register(payload);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Registration failed' });
  }
});
