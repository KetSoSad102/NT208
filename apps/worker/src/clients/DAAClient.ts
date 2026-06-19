export interface DAAStudentResult {
  mssv: string;
  fullName: string;
  classCode: string;
  className?: string;
  termCode: string;
  termName?: string;
  termStartDate?: string;
  termEndDate?: string;
  courseCode: string;
  courseName: string;
  credits: number;
  attemptNo?: number;
  isRetake?: boolean;
  processScore?: number;
  midtermScore: number;
  practicalScore?: number;
  finalScore: number;
  overallScore: number;
  letterGrade?: string;
  passed?: boolean;
  sourceSystem?: string;
  lecturerName: string;
}

export interface DAAPayload {
  sourceName: string;
  generatedAt: string;
  results: DAAStudentResult[];
}

export interface DAAClient {
  fetchSnapshot(cookie?: string): Promise<DAAPayload>;
}
