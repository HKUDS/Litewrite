# ==============================================================================
# Litewrite AI Server Dockerfile
# ==============================================================================
# Multi-stage build, production-ready
#
# Build:
#   docker build -t litewrite-ai-server .
#
# Run:
#   docker run -p 6612:6612 --env-file .env litewrite-ai-server
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder
# ------------------------------------------------------------------------------
FROM python:3.11-slim as builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY requirements.txt .

# Create venv and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install dependencies (including production extras)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir \
        gunicorn \
        uvicorn[standard] \
        redis

# ------------------------------------------------------------------------------
# Stage 2: Runtime
# ------------------------------------------------------------------------------
FROM python:3.11-slim as runtime

# Metadata
LABEL maintainer="Litewrite Team"
LABEL version="2.1.0"
LABEL description="Litewrite AI Server - Production Ready"

# Create non-root user
RUN groupadd -r aiserver && useradd -r -g aiserver aiserver

WORKDIR /app

# Copy venv from builder stage
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application code
COPY --chown=aiserver:aiserver . .

# Create required directories
RUN mkdir -p /app/logs /app/cache && \
    chown -R aiserver:aiserver /app/logs /app/cache

# Switch to non-root user
USER aiserver

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV ENV=production

# Expose port
EXPOSE 6612

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:6612/health/live')" || exit 1

# Start command (Gunicorn in production)
CMD ["gunicorn", "main:app", "-c", "gunicorn.conf.py"]
