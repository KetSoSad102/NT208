import { ImportJobStatus } from '@cvht/shared';
import { pool } from '../db.js';
import { logger } from '../logger.js';
import { MockDAAClient } from '../clients/MockDAAClient.js';
import type { DAAClient, DAAStudentResult } from '../clients/DAAClient.js';
import { runAnalytics } from '../services/analytics.js';

function computeLetterGrade(score: number): string {
  if (score >= 8.5) return 'A';
  if (score >= 7.0) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 5.0) return 'D';
  return 'F';
}

interface TermInfo {
  termCode: string;
  termName: string;
  startDate: string;
  endDate: string;
}

function inferTermDates(termCode: string): { startDate: string; endDate: string } {
  const match = termCode.match(/(?:HK)?([123])[._-]?(\d{4})/i);
  if (match) {
    const semester = Number(match[1]);
    const year = Number(match[2]);
    if (semester === 1) return { startDate: `${year}-09-01`, endDate: `${year + 1}-01-15` };
    if (semester === 2) return { startDate: `${year}-02-01`, endDate: `${year}-06-15` };
    return { startDate: `${year}-07-01`, endDate: `${year}-08-15` };
  }
  const now = new Date().toISOString().slice(0, 10);
  return { startDate: now, endDate: now };
}

function uniqueByKey<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()];
}

async function processPayload(
  jobId: string,
  client: DAAClient,
  cookie?: string,
): Promise<number> {
  const payload = await client.fetchSnapshot(cookie);
  if (payload.results.length === 0) return 0;

  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const classes = uniqueByKey(payload.results, (r) => r.classCode).map((r) => ({
      classCode: r.classCode,
      className: r.className ?? r.classCode,
    }));

    await conn.query(
      `
        INSERT INTO classes (class_code, class_name)
        SELECT * FROM UNNEST($1::text[], $2::text[])
        ON CONFLICT (class_code) DO NOTHING
      `,
      [classes.map((c) => c.classCode), classes.map((c) => c.className)],
    );

    const terms: TermInfo[] = uniqueByKey(payload.results, (r) => r.termCode).map((r) => {
      const fallback = inferTermDates(r.termCode);
      return {
        termCode: r.termCode,
        termName: r.termName ?? r.termCode,
        startDate: r.termStartDate ?? fallback.startDate,
        endDate: r.termEndDate ?? fallback.endDate,
      };
    });

    await conn.query(
      `
        INSERT INTO terms (term_code, term_name, start_date, end_date)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::date[], $4::date[])
        ON CONFLICT (term_code) DO UPDATE SET
          term_name = EXCLUDED.term_name,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date
      `,
      [
        terms.map((t) => t.termCode),
        terms.map((t) => t.termName),
        terms.map((t) => t.startDate),
        terms.map((t) => t.endDate),
      ],
    );

    const courses = uniqueByKey(payload.results, (r) => r.courseCode).map((r) => ({
      courseCode: r.courseCode,
      courseName: r.courseName,
      credits: r.credits,
    }));

    await conn.query(
      `
        INSERT INTO courses (course_code, course_name, credits)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[])
        ON CONFLICT (course_code) DO UPDATE SET
          course_name = EXCLUDED.course_name,
          credits = EXCLUDED.credits
      `,
      [
        courses.map((c) => c.courseCode),
        courses.map((c) => c.courseName),
        courses.map((c) => c.credits),
      ],
    );

    const students = uniqueByKey(payload.results, (r) => r.mssv).map((r) => ({
      mssv: r.mssv,
      fullName: r.fullName,
      classCode: r.classCode,
    }));

    await conn.query(
      `
        INSERT INTO students (mssv, full_name, class_id)
        SELECT u.mssv, u.full_name, cl.id
        FROM UNNEST($1::text[], $2::text[], $3::text[]) AS u(mssv, full_name, class_code)
        JOIN classes cl ON cl.class_code = u.class_code
        ON CONFLICT (mssv) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          class_id = EXCLUDED.class_id
      `,
      [
        students.map((s) => s.mssv),
        students.map((s) => s.fullName),
        students.map((s) => s.classCode),
      ],
    );

    const offerings = uniqueByKey(
      payload.results,
      (r) => `${r.courseCode}|${r.termCode}|${r.classCode}`,
    ).map((r) => ({
      courseCode: r.courseCode,
      termCode: r.termCode,
      classCode: r.classCode,
      lecturerName: r.lecturerName,
    }));

    await conn.query(
      `
        INSERT INTO course_offerings (course_id, term_id, class_id, lecturer_name)
        SELECT c.id, t.id, cl.id, u.lecturer_name
        FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
          AS u(course_code, term_code, class_code, lecturer_name)
        JOIN courses c ON c.course_code = u.course_code
        JOIN terms t ON t.term_code = u.term_code
        JOIN classes cl ON cl.class_code = u.class_code
        ON CONFLICT (course_id, term_id, class_id) DO UPDATE SET
          lecturer_name = EXCLUDED.lecturer_name
      `,
      [
        offerings.map((o) => o.courseCode),
        offerings.map((o) => o.termCode),
        offerings.map((o) => o.classCode),
        offerings.map((o) => o.lecturerName),
      ],
    );

    const enrollmentRows = payload.results.map((row: DAAStudentResult) => {
      const overallScore = row.overallScore ?? row.finalScore;
      const attemptNo = row.attemptNo ?? 1;
      return {
        mssv: row.mssv,
        courseCode: row.courseCode,
        termCode: row.termCode,
        classCode: row.classCode,
        attemptNo,
        processScore: row.processScore ?? row.midtermScore,
        midtermScore: row.midtermScore,
        practicalScore: row.practicalScore ?? row.midtermScore,
        finalScore: row.finalScore,
        overallScore,
        letterGrade: row.letterGrade ?? computeLetterGrade(overallScore),
        passed: row.passed ?? overallScore >= 5,
        isRetake: row.isRetake ?? attemptNo > 1,
        sourceSystem: row.sourceSystem ?? payload.sourceName,
      };
    });

    await conn.query(
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
        SELECT
          s.id,
          co.id,
          u.attempt_no,
          u.process_score,
          u.midterm_score,
          u.practical_score,
          u.final_score,
          u.overall_score,
          u.letter_grade,
          u.passed,
          u.is_retake,
          NOW(),
          u.source_system
        FROM UNNEST(
          $1::text[],
          $2::text[],
          $3::text[],
          $4::text[],
          $5::int[],
          $6::numeric[],
          $7::numeric[],
          $8::numeric[],
          $9::numeric[],
          $10::numeric[],
          $11::text[],
          $12::boolean[],
          $13::boolean[],
          $14::text[]
        ) AS u(
          mssv, course_code, term_code, class_code, attempt_no,
          process_score, midterm_score, practical_score, final_score, overall_score,
          letter_grade, passed, is_retake, source_system
        )
        JOIN students s ON s.mssv = u.mssv
        JOIN courses c ON c.course_code = u.course_code
        JOIN terms t ON t.term_code = u.term_code
        JOIN classes cl ON cl.class_code = u.class_code
        JOIN course_offerings co
          ON co.course_id = c.id AND co.term_id = t.id AND co.class_id = cl.id
        ON CONFLICT (student_id, course_offering_id)
        DO UPDATE SET
          attempt_no = EXCLUDED.attempt_no,
          process_score = EXCLUDED.process_score,
          midterm_score = EXCLUDED.midterm_score,
          practical_score = EXCLUDED.practical_score,
          final_score = EXCLUDED.final_score,
          overall_score = EXCLUDED.overall_score,
          letter_grade = EXCLUDED.letter_grade,
          passed = EXCLUDED.passed,
          is_retake = EXCLUDED.is_retake,
          synced_at = NOW(),
          source_system = EXCLUDED.source_system
      `,
      [
        enrollmentRows.map((r) => r.mssv),
        enrollmentRows.map((r) => r.courseCode),
        enrollmentRows.map((r) => r.termCode),
        enrollmentRows.map((r) => r.classCode),
        enrollmentRows.map((r) => r.attemptNo),
        enrollmentRows.map((r) => r.processScore),
        enrollmentRows.map((r) => r.midtermScore),
        enrollmentRows.map((r) => r.practicalScore),
        enrollmentRows.map((r) => r.finalScore),
        enrollmentRows.map((r) => r.overallScore),
        enrollmentRows.map((r) => r.letterGrade),
        enrollmentRows.map((r) => r.passed),
        enrollmentRows.map((r) => r.isRetake),
        enrollmentRows.map((r) => r.sourceSystem),
      ],
    );

    await conn.query(
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

    await conn.query(
      `UPDATE import_jobs SET records_processed = $1 WHERE id = $2`,
      [enrollmentRows.length, jobId],
    );

    await conn.query('COMMIT');
    return enrollmentRows.length;
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }
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

const STUCK_JOB_TIMEOUT_MINUTES = 15;

export async function recoverStuckJobs(): Promise<number> {
  const res = await pool.query(
    `
      UPDATE import_jobs
      SET status = 'queued', started_at = NULL,
          error_message = COALESCE(error_message, 'Recovered from stuck running state')
      WHERE status = 'running'
        AND started_at IS NOT NULL
        AND started_at < NOW() - INTERVAL '${STUCK_JOB_TIMEOUT_MINUTES} minutes'
      RETURNING id
    `,
  );
  if ((res.rowCount ?? 0) > 0) {
    logger.warn({ count: res.rowCount }, 'Recovered stuck import jobs');
  }
  return res.rowCount ?? 0;
}

export async function processQueuedJobs(client: DAAClient = new MockDAAClient()): Promise<void> {
  await recoverStuckJobs();

  const job = await pool.query<{ id: string; daa_cookie: string | null }>(
    `
      WITH picked AS (
        SELECT id
        FROM import_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE import_jobs j
      SET status = 'running', started_at = NOW(), error_message = NULL
      FROM picked
      WHERE j.id = picked.id
      RETURNING j.id, j.daa_cookie
    `,
  );

  if (job.rowCount === 0) return;
  const jobId = job.rows[0].id;
  const jobCookie = job.rows[0].daa_cookie;

  const maxRetries = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const processed = await processPayload(jobId, client, jobCookie ?? undefined);
      await pool.query(
        `UPDATE import_jobs SET status = $1, finished_at = NOW() WHERE id = $2`,
        [ImportJobStatus.SUCCESS, jobId],
      );
      try {
        await runAnalytics();
      } catch (analyticsError) {
        logger.error({ jobId, analyticsError }, 'Post-ingest analytics failed');
      }
      logger.info({ jobId, processed }, 'Import job done');
      return;
    } catch (error) {
      lastError = error;
      logger.error({ jobId, attempt, error }, 'Import attempt failed');
    }
  }
  await markFailed(jobId, lastError);
}
