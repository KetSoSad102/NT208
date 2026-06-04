ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'LECTURER';

ALTER TABLE course_offerings
  ADD COLUMN IF NOT EXISTS lecturer_user_id UUID REFERENCES users(id);

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS process_score NUMERIC(5,2) CHECK (process_score IS NULL OR (process_score >= 0 AND process_score <= 10)),
  ADD COLUMN IF NOT EXISTS practical_score NUMERIC(5,2) CHECK (practical_score IS NULL OR (practical_score >= 0 AND practical_score <= 10)),
  ADD COLUMN IF NOT EXISTS overall_score NUMERIC(5,2) CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 10)),
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'seed';

CREATE INDEX IF NOT EXISTS idx_course_offerings_lecturer_user_id
  ON course_offerings(lecturer_user_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_synced_at
  ON enrollments(synced_at);

CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at
  ON import_jobs(created_at DESC);
