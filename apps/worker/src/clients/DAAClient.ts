export interface DAAStudentResult {
  mssv: string;
  fullName: string;
  classCode: string;
  termCode: string;
  courseCode: string;
  courseName: string;
  credits: number;
  finalScore: number;
}

export interface DAAPayload {
  sourceName: string;
  generatedAt: string;
  results: DAAStudentResult[];
}

export interface DAAClient {
  fetchSnapshot(): Promise<DAAPayload>;
}
