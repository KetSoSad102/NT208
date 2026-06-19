import { z } from 'zod';
import type { DAAClient, DAAPayload } from './DAAClient.js';

const PayloadSchema = z.object({
  sourceName: z.string(),
  generatedAt: z.string(),
  results: z.array(
    z.object({
      mssv: z.string(),
      fullName: z.string(),
      classCode: z.string(),
      className: z.string().optional(),
      termCode: z.string(),
      termName: z.string().optional(),
      termStartDate: z.string().optional(),
      termEndDate: z.string().optional(),
      courseCode: z.string(),
      courseName: z.string(),
      credits: z.number().int().positive(),
      attemptNo: z.number().int().positive().optional(),
      isRetake: z.boolean().optional(),
      processScore: z.number().min(0).max(10).optional(),
      midtermScore: z.number().min(0).max(10),
      practicalScore: z.number().min(0).max(10).optional(),
      finalScore: z.number().min(0).max(10),
      overallScore: z.number().min(0).max(10),
      letterGrade: z.string().optional(),
      passed: z.boolean().optional(),
      sourceSystem: z.string().optional(),
      lecturerName: z.string(),
    }),
  ),
});

export class RealDAAClient implements DAAClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken?: string,
  ) {}

  async fetchSnapshot(cookie?: string): Promise<DAAPayload> {
    const normalizedBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const headers: Record<string, string> = {};
    if (cookie) {
      headers['Cookie'] = cookie;
    } else if (this.apiToken) {
      headers['X-DAA-Token'] = this.apiToken;
    }
    const res = await fetch(`${normalizedBaseUrl}/daa-demo/api/snapshot`, { headers });

    if (!res.ok) {
      throw new Error(`DAA fetch failed with HTTP ${res.status}`);
    }

    return PayloadSchema.parse(await res.json());
  }
}
