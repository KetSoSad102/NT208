export interface DAAStudentResult {
  mssv: string;
  fullName: string;
  classCode: string;
  termCode: string;
  courseCode: string;
  courseName: string;
  credits: number;
  processScore?: number;
  midtermScore: number;
  practicalScore?: number;
  finalScore: number;
  overallScore: number;
  lecturerName: string;
}

export interface DAAPayload {
  sourceName: string;
  generatedAt: string;
  results: DAAStudentResult[];
}

export interface DAAClient {
  fetchSnapshot(): Promise<DAAPayload>;
}
