import { ImportJobStatus } from '@cvht/shared';
import { pool } from '../db.js';
import { logger } from '../logger.js';
import { MockDAAClient } from '../clients/MockDAAClient.js';
import type { DAAClient } from '../clients/DAAClient.js';
import { runAnalytics } from '../services/analytics.js';

function letterGrade(score: number): string {
  if (score >= 8.5) return 'A';
  if (score >= 7.0) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 4.0) return 'D';
  return 'F';
}

async function processPayload(jobId: string, client: DAAClient): Promise<number> {
  const payload = await client.fetchSnapshot();

  let processed = 0;
  for (const row of payload.results) {
    await pool.query(
      `
        INSERT INTO classes (class_code, class_name)
        VALUES ($1, $1)
        ON CONFLICT (class_code) DO NOTHING
      `,
      [row.classCode],
    );

    await pool.query(
      `
        INSERT INTO terms (term_code, term_name, start_date, end_date)
        VALUES ($1, $1, '2026-01-01', '2026-12-31')
        ON CONFLICT (term_code) DO NOTHING
      `,
      [row.termCode],
    );

    await pool.query(
      `
        INSERT INTO courses (course_code, course_name, credits)
        VALUES ($1, $2, $3)
        ON CONFLICT (course_code) DO UPDATE SET
          course_name = EXCLUDED.course_name,
          credits = EXCLUDED.credits
      `,
      [row.courseCode, row.courseName, row.credits],
    );

    const classRs = await pool.query<{ id: string }>('SELECT id FROM classes WHERE class_code = $1', [
      row.classCode,
    ]);

    await pool.query(
      `
        INSERT INTO students (mssv, full_name, class_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (mssv) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          class_id = EXCLUDED.class_id
      `,
      [row.mssv, row.fullName, classRs.rows[0].id],
    );

    await pool.query(
      `
        INSERT INTO course_offerings (course_id, term_id, class_id, lecturer_name)
        VALUES (
          (SELECT id FROM courses WHERE course_code = $1),
          (SELECT id FROM terms WHERE term_code = $2),
          (SELECT id FROM classes WHERE class_code = $3),
          'Imported Lecturer'
        )
        ON CONFLICT (course_id, term_id, class_id) DO NOTHING
      `,
      [row.courseCode, row.termCode, row.classCode],
    );

    await pool.query(
      `
        INSERT INTO enrollments (
          student_id,
          course_offering_id,
          attempt_no,
          midterm_score,
          final_score,
          letter_grade,
          passed,
          is_retake
        )
        VALUES (
          (SELECT id FROM students WHERE mssv = $1),
          (
            SELECT co.id
            FROM course_offerings co
            JOIN courses c ON c.id = co.course_id
            JOIN terms t ON t.id = co.term_id
            JOIN classes cl ON cl.id = co.class_id
            WHERE c.course_code = $2
              AND t.term_code = $3
              AND cl.class_code = $4
            LIMIT 1
          ),
          1,
          $5,
          $6,
          $7,
          $8,
          $9
        )
        ON CONFLICT (student_id, course_offering_id)
        DO UPDATE SET
          final_score = EXCLUDED.final_score,
          midterm_score = EXCLUDED.midterm_score,
          letter_grade = EXCLUDED.letter_grade,
          passed = EXCLUDED.passed,
          is_retake = EXCLUDED.is_retake
      `,
      [
        row.mssv,
        row.courseCode,
        row.termCode,
        row.classCode,
        Math.max(0, Math.min(10, row.finalScore - 0.5)),
        row.finalScore,
        letterGrade(row.finalScore),
        row.finalScore >= 4,
        row.finalScore < 4,
      ],
    );

    processed += 1;
  }

  await pool.query(
    `
      UPDATE students s
      SET current_gpa = stats.avg_score
      FROM (
        SELECT student_id, ROUND(AVG(final_score)::numeric, 2) AS avg_score
        FROM enrollments
        GROUP BY student_id
      ) AS stats
      WHERE stats.student_id = s.id
    `,
  );

  await runAnalytics();
  await pool.query(
    `
      UPDATE import_jobs
      SET records_processed = $1
      WHERE id = $2
    `,
    [processed, jobId],
  );

  return processed;
}

async function markFailed(jobId: string, error: unknown): Promise<void> {
  await pool.query(
    `
      UPDATE import_jobs
      SET status = $1,
          error_message = $2,
          finished_at = NOW()
      WHERE id = $3
    `,
    [ImportJobStatus.FAIL, error instanceof Error ? error.message : 'Unknown error', jobId],
  );
}

export async function processQueuedJobs(client: DAAClient = new MockDAAClient()): Promise<void> {
  const job = await pool.query<{ id: string }>(
    `
      WITH picked AS (
        SELECT id
        FROM import_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      )
      UPDATE import_jobs j
      SET status = 'running', started_at = NOW(), error_message = NULL
      FROM picked
      WHERE j.id = picked.id
      RETURNING j.id
    `,
  );

  if (job.rowCount === 0) return;
  const jobId = job.rows[0].id;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await processPayload(jobId, client);
      await pool.query(
        `UPDATE import_jobs SET status = $1, finished_at = NOW() WHERE id = $2`,
        [ImportJobStatus.SUCCESS, jobId],
      );
      logger.info({ jobId }, 'Import job done');
      return;
    } catch (error) {
      logger.error({ jobId, attempt, error }, 'Import attempt failed');
      if (attempt === maxRetries) {
        await markFailed(jobId, error);
        return;
      }
    }
  }
}
