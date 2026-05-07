#!/bin/bash
set -e

# Echo helper
echo_step() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] - $1"
}

# Validate environment
echo_step "Validating environment..."
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL is required"
    exit 1
fi

# Run migrations
echo_step "Running database migrations..."
cd /app
python apps/api-python/scripts/migrate.py || {
    echo "ERROR: Migration failed"
    exit 1
}

# Run seed (seeding existing data if needed)
echo_step "Running database seed..."
python apps/api-python/scripts/seed.py || {
    echo "ERROR: Seed failed"
    exit 1
}

# Start FastAPI server
echo_step "Starting FastAPI server on port ${API_PORT:-3000}..."
cd /app/apps/api-python
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${API_PORT:-3000}" \
    --workers "${UVICORN_WORKERS:-2}" \
    --log-level "${LOG_LEVEL:-info}"
