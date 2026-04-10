import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")

migrations_dir = Path(__file__).resolve().parents[3] / "infra" / "migrations"

with psycopg2.connect(DATABASE_URL) as conn:
    with conn.cursor() as cur:
        for migration in sorted(migrations_dir.glob("*.sql")):
            sql = migration.read_text(encoding="utf-8")
            cur.execute(sql)

print("Migrations completed")
