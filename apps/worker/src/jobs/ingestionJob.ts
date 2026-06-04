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
  if (score >= 5.0) return 'D';
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
          $4
        )
        ON CONFLICT (course_id, term_id, class_id) DO UPDATE SET
          lecturer_name = EXCLUDED.lecturer_name
      `,
      [row.courseCode, row.termCode, row.classCode, row.lecturerName],
    );

    const overallScore = row.overallScore ?? row.finalScore;
    await pool.query(
      `
        INSERT INTO enrollments (
          student_id,
          course_offering_id,
          attempt_no,
          process_score,
          midterm_score,
          practical_score,
          final_score,
          overall_score,
          letter_grade,
          passed,
          is_retake,
          synced_at,
          source_system
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
          $9,
          $10,
          $11,
          $12,
          NOW(),
          $13
        )
        ON CONFLICT (student_id, course_offering_id)
        DO UPDATE SET
          process_score = EXCLUDED.process_score,
          final_score = EXCLUDED.final_score,
          midterm_score = EXCLUDED.midterm_score,
          practical_score = EXCLUDED.practical_score,
          overall_score = EXCLUDED.overall_score,
          letter_grade = EXCLUDED.letter_grade,
          passed = EXCLUDED.passed,
          is_retake = EXCLUDED.is_retake,
          synced_at = NOW(),
          source_system = EXCLUDED.source_system
      `,
      [
        row.mssv,
        row.courseCode,
        row.termCode,
        row.classCode,
        row.processScore ?? row.midtermScore,
        row.midtermScore,
        row.practicalScore ?? row.midtermScore,
        row.finalScore,
        overallScore,
        letterGrade(overallScore),
        overallScore >= 5,
        overallScore < 5,
        payload.sourceName,
      ],
    );

    processed += 1;
  }

  await pool.query(
    `
      UPDATE students s
      SET current_gpa = stats.avg_score
      FROM (
        SELECT student_id, ROUND(AVG(COALESCE(overall_score, final_score))::numeric, 2) AS avg_score
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
