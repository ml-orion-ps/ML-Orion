# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS frontend-builder
WORKDIR /build

# Install dependencies first for layer caching
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY frontend/ ./
RUN node script/build.mjs
# Output lands in /build/dist/public/

# ── Stage 2: Python runtime ────────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# System deps for psycopg2-binary and scientific packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY backend/ ./backend/
COPY ML_backend/ ./ML_backend/

# Built React app (FastAPI serves this as static files)
COPY --from=frontend-builder /build/dist/public ./dist/public

EXPOSE 8000

# Run from /app/backend so "from database import ..." resolves correctly
WORKDIR /app/backend
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
