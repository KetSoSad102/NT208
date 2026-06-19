import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://cvht:cvht@localhost:5432/cvht")

def check_jobs():
    try:
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, source_name, status, error_message, created_at, daa_cookie
                FROM import_jobs
                ORDER BY created_at DESC
                LIMIT 5
            """)
            rows = cur.fetchall()
            for row in rows:
                print(f"Job ID: {row['id']}")
                print(f"  Source: {row['source_name']}")
                print(f"  Status: {row['status']}")
                print(f"  Error:  {row['error_message']}")
                print(f"  Cookie: {'[PRESENT]' if row['daa_cookie'] else '[MISSING]'}")
                print(f"  Time:   {row['created_at']}")
                print("-" * 20)
        conn.close()
    except Exception as e:
        print(f"Error connecting to DB: {e}")

if __name__ == "__main__":
    check_jobs()
