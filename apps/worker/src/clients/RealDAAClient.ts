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
      termCode: z.string(),
      courseCode: z.string(),
      courseName: z.string(),
      credits: z.number().int().positive(),
      processScore: z.number().min(0).max(10).optional(),
      midtermScore: z.number().min(0).max(10),
      practicalScore: z.number().min(0).max(10).optional(),
      finalScore: z.number().min(0).max(10),
      overallScore: z.number().min(0).max(10),
      lecturerName: z.string(),
    }),
  ),
});

export class RealDAAClient implements DAAClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken?: string,
  ) {}

  async fetchSnapshot(): Promise<DAAPayload> {
    const normalizedBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const res = await fetch(`${normalizedBaseUrl}/daa-demo/api/snapshot`, {
      headers: this.apiToken ? { 'X-DAA-Token': this.apiToken } : {},
    });

    if (!res.ok) {
      throw new Error(`DAA fetch failed with HTTP ${res.status}`);
    }

    return PayloadSchema.parse(await res.json());
  }
}
