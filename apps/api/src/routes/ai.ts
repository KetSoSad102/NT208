import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

type ScopedQuery = { sql: string; params: Array<string | number> };
type LlmSqlResult = { sql: string; explanation: string; model: string; provider: 'openai' | 'gemini' };

const MUTATION_KEYWORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|call)\b/i;
const ALLOWED_FROM = /\b(from|join)\s+([a-z_][a-z0-9_]*)/gi;

function cleanSql(raw: string): string {
  return raw.replace(/```sql|```/gi, '').trim();
}

function parseModelJson(text: string): { sql: string; explanation?: string } {
  const trimmed = text.trim();
  const noFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(noFence) as { sql: string; explanation?: string };
  } catch {
    const start = noFence.indexOf('{');
    const end = noFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(noFence.slice(start, end + 1)) as { sql: string; explanation?: string };
    }
    throw new Error('LLM_BAD_JSON');
  }
}

function validateGeneratedSql(sql: string): string | null {
  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select')) {
    return 'SQL phải bắt đầu bằng SELECT.';
  }
  if (sql.includes(';')) {
    return 'Không cho phép nhiều câu SQL hoặc dấu chấm phẩy.';
  }
  if (MUTATION_KEYWORDS.test(sql)) {
    return 'Chỉ cho phép truy vấn read-only (SELECT).';
  }
  if (!/\blimit\s+\d+\b/i.test(sql)) {
    return 'SQL bắt buộc có LIMIT.';
  }
  const fromTargets = [...sql.matchAll(ALLOWED_FROM)].map((m) => m[2].toLowerCase());
  if (fromTargets.some((name) => name !== 'scoped_data')) {
    return 'SQL chỉ được truy vấn từ bảng ảo scoped_data.';
  }
  return null;
}

function llmPrompt(): string {
  return `
Bạn là chuyên gia chuyển câu hỏi tiếng Việt sang SQL PostgreSQL.
Chỉ trả về JSON hợp lệ với đúng schema:
{"sql":"SELECT ...","explanation":"..."}

Ràng buộc bắt buộc:
- CHỈ SELECT read-only.
- KHÔNG dùng dấu ;.
- BẮT BUỘC có LIMIT <= 200.
- CHỈ được truy vấn duy nhất từ bảng ảo "scoped_data".
- Không truy cập bảng nào khác.
`;
}

async function callOpenAiForSql(question: string): Promise<LlmSqlResult> {
  const apiKey = env.OPENAI_API_KEY || env.LLM_API_KEY;
  const model = env.OPENAI_MODEL || env.LLM_MODEL;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: llmPrompt() },
        { role: 'user', content: question },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    logger.error({ status: resp.status, errText }, 'OpenAI call failed');
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('INVALID_API_KEY');
    }
    if (resp.status === 429) {
      throw new Error('OPENAI_QUOTA_EXCEEDED');
    }
    throw new Error('OPENAI_API_ERROR');
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OPENAI_EMPTY_RESPONSE');
  }

  const parsed = z
    .object({
      sql: z.string().min(1),
      explanation: z.string().min(1).max(1200).optional().default(''),
    })
    .parse(parseModelJson(content));

  return {
    sql: cleanSql(parsed.sql),
    explanation: parsed.explanation,
    model,
    provider: 'openai',
  };
}

async function callGeminiForSql(question: string): Promise<LlmSqlResult> {
  const apiKey = env.GEMINI_API_KEY || env.LLM_API_KEY;
  const model = env.GEMINI_MODEL || env.LLM_MODEL || 'gemini-2.0-flash';
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: llmPrompt() }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: question }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    logger.error({ status: resp.status, errText }, 'Gemini call failed');
    if (resp.status === 503) {
      throw new Error('LLM_TEMP_UNAVAILABLE');
    }
    if (resp.status === 404) {
      throw new Error('LLM_MODEL_NOT_FOUND');
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('INVALID_API_KEY');
    }
    if (resp.status === 429) {
      throw new Error('LLM_QUOTA_EXCEEDED');
    }
    throw new Error('LLM_API_ERROR');
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error('LLM_EMPTY_RESPONSE');
  }

  const parsed = z
    .object({
      sql: z.string().min(1),
      explanation: z.string().min(1).max(1200).optional().default(''),
    })
    .parse(parseModelJson(content));

  return {
    sql: cleanSql(parsed.sql),
    explanation: parsed.explanation,
    model,
    provider: 'gemini',
  };
}

async function callLlmForSql(question: string): Promise<LlmSqlResult> {
  const provider = (env.LLM_PROVIDER || 'openai').toLowerCase();
  if (provider === 'gemini' || provider === 'google') {
    return callGeminiForSql(question);
  }
  return callOpenAiForSql(question);
}

function scopedClassFilter(req: AuthRequest, classAlias = 'c'): ScopedQuery {
  if (!req.user) return { sql: '1=0', params: [] };
  if (req.user.role === 'DEAN_ADMIN') return { sql: '1=1', params: [] };
  return { sql: `${classAlias}.advisor_user_id = $1`, params: [req.user.userId] };
}

function buildStudentsRiskQuery(req: AuthRequest, classCode?: string): ScopedQuery {
  const scope = scopedClassFilter(req, 'c');
  const params = [...scope.params];
  const where = [scope.sql];
  if (classCode) {
    params.push(classCode);
    where.push(`c.class_code = $${params.length}`);
  }

  const sql = `
    WITH agg AS (
      SELECT
        s.id AS student_id,
        s.mssv,
        s.full_name,
        c.class_code,
        s.current_gpa,
        c.required_credits,
        COALESCE(SUM(CASE WHEN e.passed THEN cr.credits ELSE 0 END), 0) AS completed_credits,
        SUM(CASE WHEN e.passed = false THEN 1 ELSE 0 END) AS failed_courses,
        SUM(CASE WHEN e.final_score < 5 THEN 1 ELSE 0 END) AS low_score_courses
      FROM students s
      JOIN classes c ON c.id = s.class_id
      LEFT JOIN enrollments e ON e.student_id = s.id
      LEFT JOIN course_offerings co ON co.id = e.course_offering_id
      LEFT JOIN courses cr ON cr.id = co.course_id
      WHERE ${where.join(' AND ')}
      GROUP BY s.id, s.mssv, s.full_name, c.class_code, s.current_gpa, c.required_credits
    ),
    latest_risk AS (
      SELECT DISTINCT ON (student_id)
        student_id,
        delay_risk_score,
        risk_band,
        quadrant,
        recommended_action
      FROM risk_snapshots
      ORDER BY student_id, created_at DESC
    )
    SELECT
      a.student_id AS id,
      a.mssv,
      a.full_name AS "fullName",
      a.class_code AS "classCode",
      a.current_gpa AS "currentGpa",
      a.completed_credits AS "completedCredits",
      a.required_credits AS "requiredCredits",
      GREATEST(a.required_credits - a.completed_credits, 0) AS "debtCredits",
      ROUND((a.completed_credits::numeric / NULLIF(a.required_credits, 0)) * 100, 2) AS "completionRatio",
      a.failed_courses AS "failedCourses",
      a.low_score_courses AS "lowScoreCourses",
      COALESCE(lr.delay_risk_score, 15) AS "delayRiskScore",
      COALESCE(lr.risk_band, 'low') AS "riskBand",
      COALESCE(lr.quadrant, 'safe_zone') AS quadrant,
      COALESCE(lr.recommended_action, 'Theo doi dinh ky') AS "recommendedAction"
    FROM agg a
    LEFT JOIN latest_risk lr ON lr.student_id = a.student_id
    ORDER BY "delayRiskScore" DESC, a.mssv
  `;

  return { sql, params };
}

const PredictiveQuerySchema = z.object({
  classCode: z.string().optional(),
});

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get('/overview', async (req: AuthRequest, res) => {
  const riskQuery = buildStudentsRiskQuery(req);
  const rs = await pool.query<{
    id: string;
    mssv: string;
    fullName: string;
    classCode: string;
    currentGpa: string;
    completedCredits: string;
    requiredCredits: string;
    debtCredits: string;
    completionRatio: string;
    failedCourses: string;
    lowScoreCourses: string;
    delayRiskScore: string;
    riskBand: string;
    quadrant: string;
    recommendedAction: string;
  }>(riskQuery.sql, riskQuery.params);

  const rows = rs.rows.map((r) => ({
    id: r.id,
    mssv: r.mssv,
    fullName: r.fullName,
    classCode: r.classCode,
    currentGpa: Number(r.currentGpa),
    completedCredits: Number(r.completedCredits),
    requiredCredits: Number(r.requiredCredits),
    debtCredits: Number(r.debtCredits),
    completionRatio: Number(r.completionRatio),
    failedCourses: Number(r.failedCourses),
    lowScoreCourses: Number(r.lowScoreCourses),
    delayRiskScore: Number(r.delayRiskScore),
    riskBand: r.riskBand,
    quadrant: r.quadrant,
    recommendedAction: r.recommendedAction,
  }));

  const highRisk = rows.filter((r) => r.delayRiskScore >= 55).length;
  const critical = rows.filter((r) => r.delayRiskScore >= 75).length;
  const averageRisk = rows.length
    ? Number((rows.reduce((acc, r) => acc + r.delayRiskScore, 0) / rows.length).toFixed(1))
    : 0;

  res.json({
    kpis: {
      students: rows.length,
      highRisk,
      critical,
      alerts: highRisk,
      averageRisk,
    },
    topRisks: rows.slice(0, 8),
  });
});

aiRouter.get('/predictive/students', async (req: AuthRequest, res) => {
  const query = PredictiveQuerySchema.parse(req.query);
  const riskQuery = buildStudentsRiskQuery(req, query.classCode);
  const rs = await pool.query(riskQuery.sql, riskQuery.params);
  res.json(
    rs.rows.map((r) => ({
      ...r,
      currentGpa: Number(r.currentGpa),
      completedCredits: Number(r.completedCredits),
      requiredCredits: Number(r.requiredCredits),
      debtCredits: Number(r.debtCredits),
      completionRatio: Number(r.completionRatio),
      failedCourses: Number(r.failedCourses),
      lowScoreCourses: Number(r.lowScoreCourses),
      delayRiskScore: Number(r.delayRiskScore),
    })),
  );
});

aiRouter.get('/predictive/matrix', async (req: AuthRequest, res) => {
  const query = PredictiveQuerySchema.parse(req.query);
  const riskQuery = buildStudentsRiskQuery(req, query.classCode);
  const rs = await pool.query<{
    mssv: string;
    fullName: string;
    classCode: string;
    completionRatio: string;
    currentGpa: string;
    delayRiskScore: string;
    quadrant: string;
  }>(riskQuery.sql, riskQuery.params);

  res.json({
    points: rs.rows.map((r) => ({
      mssv: r.mssv,
      fullName: r.fullName,
      classCode: r.classCode,
      x: Number(r.completionRatio),
      y: Number(r.currentGpa),
      risk: Number(r.delayRiskScore),
      quadrant: r.quadrant,
      blinking: Number(r.delayRiskScore) >= 70,
    })),
    quadrants: {
      credit_low_gpa_low: 'Tín chỉ thấp - GPA thấp',
      credit_low_gpa_ok: 'Tín chỉ thấp - GPA tạm ổn',
      credit_ok_gpa_low: 'Tín chỉ ổn - GPA thấp',
      safe_zone: 'Vùng an toàn',
    },
  });
});

aiRouter.get('/anomalies/briefs', async (req: AuthRequest, res) => {
  const scope = scopedClassFilter(req, 'c');
  const rs = await pool.query<{
    classCode: string;
    summary: string;
    priority: string;
    studentCount: string;
    failedNow: string;
    borderline: string;
    averageScore: string;
    highRiskCount: string;
    topRiskStudent: string | null;
  }>(
    `
      SELECT
        c.class_code AS "classCode",
        COALESCE(ab.summary, 'Lop on dinh') AS summary,
        COALESCE(ab.priority, 'normal') AS priority,
        COUNT(DISTINCT s.id)::text AS "studentCount",
        SUM(CASE WHEN e.passed = false THEN 1 ELSE 0 END)::text AS "failedNow",
        SUM(CASE WHEN e.final_score >= 4 AND e.final_score < 5 THEN 1 ELSE 0 END)::text AS borderline,
        ROUND(AVG(s.current_gpa)::numeric, 2)::text AS "averageScore",
        SUM(CASE WHEN rs.delay_risk_score >= 55 THEN 1 ELSE 0 END)::text AS "highRiskCount",
        MAX(CASE WHEN rs.delay_risk_score >= 75 THEN s.mssv ELSE NULL END) AS "topRiskStudent"
      FROM classes c
      LEFT JOIN students s ON s.class_id = c.id
      LEFT JOIN enrollments e ON e.student_id = s.id
      LEFT JOIN risk_snapshots rs ON rs.student_id = s.id
      LEFT JOIN LATERAL (
        SELECT summary, priority
        FROM ai_briefs b
        WHERE b.class_id = c.id
        ORDER BY b.created_at DESC
        LIMIT 1
      ) ab ON TRUE
      WHERE ${scope.sql}
      GROUP BY c.class_code, ab.summary, ab.priority
      ORDER BY c.class_code
    `,
    scope.params,
  );

  res.json(
    rs.rows.map((r) => ({
      classCode: r.classCode,
      summary: r.summary,
      priority: r.priority,
      metrics: {
        studentCount: Number(r.studentCount),
        failedNow: Number(r.failedNow),
        borderline: Number(r.borderline),
        averageScore: Number(r.averageScore),
        highRiskCount: Number(r.highRiskCount),
        topRiskStudent: r.topRiskStudent,
      },
    })),
  );
});

aiRouter.get('/anomalies/patterns', async (req: AuthRequest, res) => {
  const scope = scopedClassFilter(req, 'c');
  const rs = await pool.query<{
    courseCode: string;
    courseName: string;
    failCount: string;
    totalCount: string;
  }>(
    `
      SELECT
        cr.course_code AS "courseCode",
        cr.course_name AS "courseName",
        SUM(CASE WHEN e.passed = false THEN 1 ELSE 0 END)::text AS "failCount",
        COUNT(*)::text AS "totalCount"
      FROM enrollments e
      JOIN course_offerings co ON co.id = e.course_offering_id
      JOIN classes c ON c.id = co.class_id
      JOIN courses cr ON cr.id = co.course_id
      WHERE ${scope.sql}
      GROUP BY cr.course_code, cr.course_name
      ORDER BY SUM(CASE WHEN e.passed = false THEN 1 ELSE 0 END) DESC
      LIMIT 6
    `,
    scope.params,
  );

  res.json(
    rs.rows.map((r) => {
      const fail = Number(r.failCount);
      const total = Number(r.totalCount);
      const confidence = total ? Number(((fail / total) * 100).toFixed(1)) : 0;
      return {
        antecedentCode: r.courseCode,
        antecedentName: r.courseName,
        consequentCode: null,
        consequentName: null,
        supportCount: fail,
        confidence,
        message: `${r.courseName} co ti le khong dat ${confidence}% (${fail}/${total})`,
      };
    }),
  );
});

aiRouter.post('/chat-to-data', async (req: AuthRequest, res) => {
  const body = z.object({ message: z.string().min(1) }).parse(req.body);
  const scope = scopedClassFilter(req, 'c');
  const scopedDatasetSql = `
    SELECT
      s.id AS student_id,
      s.mssv,
      s.full_name,
      s.current_gpa::float8 AS current_gpa,
      c.class_code,
      c.class_name,
      c.advisor_user_id,
      t.term_code,
      cr.course_code,
      cr.course_name,
      e.attempt_no,
      e.midterm_score::float8 AS midterm_score,
      e.final_score::float8 AS final_score,
      e.passed,
      e.is_retake
    FROM students s
    JOIN classes c ON c.id = s.class_id
    LEFT JOIN enrollments e ON e.student_id = s.id
    LEFT JOIN course_offerings co ON co.id = e.course_offering_id
    LEFT JOIN courses cr ON cr.id = co.course_id
    LEFT JOIN terms t ON t.id = co.term_id
    WHERE ${scope.sql}
  `;

  let llmResult: LlmSqlResult;
  try {
    llmResult = await callLlmForSql(body.message);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'LLM_API_ERROR';
    if (msg === 'MISSING_API_KEY') {
      res.status(503).json({
        message: 'Thiếu API key LLM. Hãy cấu hình key tương ứng với provider rồi thử lại.',
      });
      return;
    }
    if (msg === 'INVALID_API_KEY') {
      res.status(401).json({
        message: 'API key LLM không hợp lệ hoặc đã hết hạn. Hãy đổi API key khác.',
      });
      return;
    }
    if (msg === 'OPENAI_QUOTA_EXCEEDED' || msg === 'LLM_QUOTA_EXCEEDED') {
      res.status(429).json({
        message: 'LLM API hết quota/billing. Hãy đổi API key khác hoặc nạp quota rồi thử lại.',
      });
      return;
    }
    if (msg === 'LLM_TEMP_UNAVAILABLE') {
      res.status(503).json({
        message: 'Gemini đang quá tải tạm thời (high demand). Hãy thử lại sau hoặc đổi model khác.',
      });
      return;
    }
    if (msg === 'LLM_MODEL_NOT_FOUND') {
      res.status(422).json({
        message: 'Model LLM không tồn tại hoặc không hỗ trợ endpoint này. Hãy đổi model khác.',
      });
      return;
    }
    res.status(502).json({
      message: 'Lỗi khi gọi LLM API. Kiểm tra provider, API key, model hoặc mạng rồi thử lại.',
    });
    return;
  }

  const validationError = validateGeneratedSql(llmResult.sql);
  if (validationError) {
    res.status(422).json({
      message: `SQL bị chặn bởi guardrail: ${validationError}`,
      sqlPreview: llmResult.sql,
    });
    return;
  }

  const finalSql = `WITH scoped_data AS (${scopedDatasetSql}) ${llmResult.sql}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const queryResult = await client.query(finalSql, scope.params);
    await client.query('COMMIT');

    res.json({
      message: body.message,
      answer: llmResult.explanation || `Đã trả về ${queryResult.rows.length} dòng dữ liệu.`,
      sqlPreview: llmResult.sql,
      rows: queryResult.rows,
      visualization: { type: 'table' },
      llmEnabled: true,
      provider: `${llmResult.provider}:${llmResult.model}`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to execute generated SQL');
    res.status(422).json({
      message: 'SQL sinh ra không chạy được trên dữ liệu hiện tại. Hãy thử diễn đạt lại câu hỏi.',
      sqlPreview: llmResult.sql,
    });
  } finally {
    client.release();
  }
});
