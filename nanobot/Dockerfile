# ==============================================================================
# Litewrite nanobot Service Dockerfile
# ==============================================================================
# Multi-stage build, production-ready
#
# Build:
#   docker build -t litewrite-nanobot .
#
# Run:
#   docker run --env-file .env litewrite-nanobot
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency file
COPY requirements.txt .

# Create venv and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ------------------------------------------------------------------------------
# Stage 2: Runtime
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

LABEL maintainer="Litewrite Team"
LABEL description="Litewrite nanobot Service"

# Create non-root user with a proper home directory
RUN groupadd -r nanobot && useradd -r -g nanobot -m -d /home/nanobot nanobot

WORKDIR /app

# Copy venv from builder stage
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application code
COPY --chown=nanobot:nanobot . .

# Create data directory at the correct home path
# (Python's Path.home() resolves to /home/nanobot for the nanobot user)
RUN mkdir -p /home/nanobot/.nanobot && chown -R nanobot:nanobot /home/nanobot/.nanobot

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV HOME=/home/nanobot

# Switch to non-root user
USER nanobot

# Default command: start gateway
CMD ["python", "main.py"]
