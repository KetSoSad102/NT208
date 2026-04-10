import { Router } from 'express';
import { z } from 'zod';
import { login } from '../services/authService.js';

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
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
