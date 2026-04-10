export type TermGPA = { termCode: string; gpa: number };

export function detectGpaDrop(termGPAs: TermGPA[], threshold = 1.5): boolean {
  if (termGPAs.length < 2) return false;
  const sorted = [...termGPAs].sort((a, b) => a.termCode.localeCompare(b.termCode));
  const prev = sorted[sorted.length - 2].gpa;
  const current = sorted[sorted.length - 1].gpa;
  return prev - current > threshold;
}

export function topKillerCourses(data: Array<{ courseCode: string; failRate: number }>, top = 5) {
  return [...data].sort((a, b) => b.failRate - a.failRate).slice(0, top);
}
