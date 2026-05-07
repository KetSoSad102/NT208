import logging
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    logger.error("DATABASE_URL is required")
    sys.exit(1)

migrations_dir = Path(__file__).resolve().parents[3] / "infra" / "migrations"

try:
    logger.info(
        f"Connecting to database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'unknown'}"
    )
    with psycopg2.connect(DATABASE_URL) as conn:
        logger.info("Database connection established")
        with conn.cursor() as cur:
            migration_files = sorted(migrations_dir.glob("*.sql"))
            logger.info(f"Found {len(migration_files)} migration files")

            for migration in migration_files:
                logger.info(f"Executing migration: {migration.name}")
                sql = migration.read_text(encoding="utf-8")
                cur.execute(sql)
                conn.commit()

            logger.info("All migrations completed successfully")
except Exception as e:
    logger.error(f"Migration failed: {str(e)}", exc_info=True)
    sys.exit(1)
