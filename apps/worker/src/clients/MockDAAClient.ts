import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DAAClient, DAAPayload } from './DAAClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PayloadSchema = z.object({
  sourceName: z.string(),
  generatedAt: z.string(),
  results: z.array(
    z.object({
      mssv: z.string(),
      fullName: z.string(),
      classCode: z.string(),
      termCode: z.string(),
      courseCode: z.string(),
      courseName: z.string(),
      credits: z.number().int().positive(),
      finalScore: z.number().min(0).max(10),
    }),
  ),
});

export class MockDAAClient implements DAAClient {
  async fetchSnapshot(): Promise<DAAPayload> {
    const fixturePath = path.resolve(__dirname, '../fixtures/mock-daa.json');
    const raw = await fs.readFile(fixturePath, 'utf-8');
    return PayloadSchema.parse(JSON.parse(raw));
  }
}
