import { describe, expect, it } from 'vitest';
import { detectGpaDrop, topKillerCourses } from '../services/analyticsRules.js';

describe('analytics rules', () => {
  it('detects GPA drop > 1.5', () => {
    const result = detectGpaDrop([
      { termCode: '2025-1', gpa: 7.5 },
      { termCode: '2025-2', gpa: 5.8 },
    ]);

    expect(result).toBe(true);
  });

  it('returns top 5 killer courses by fail rate', () => {
    const top = topKillerCourses([
      { courseCode: 'A', failRate: 0.4 },
      { courseCode: 'B', failRate: 0.1 },
      { courseCode: 'C', failRate: 0.7 },
      { courseCode: 'D', failRate: 0.5 },
      { courseCode: 'E', failRate: 0.2 },
      { courseCode: 'F', failRate: 0.9 },
    ]);

    expect(top).toHaveLength(5);
    expect(top[0].courseCode).toBe('F');
  });
});
