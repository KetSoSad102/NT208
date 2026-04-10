FROM python:3.12-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY apps/api-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY infra ./infra
COPY apps/api-python ./apps/api-python

EXPOSE 3000

CMD ["sh", "-c", "python apps/api-python/scripts/migrate.py && python apps/api-python/scripts/seed.py && cd apps/api-python && uvicorn app.main:app --host 0.0.0.0 --port 3000"]
