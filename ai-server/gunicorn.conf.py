"""
Gunicorn configuration
======================

Production runs Gunicorn with Uvicorn workers.

Start:
    gunicorn main:app -c gunicorn.conf.py

Or specify flags directly:
    gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:6612
"""

import os
import multiprocessing

# ============================================================================
# Basic settings
# ============================================================================

# Bind address and port
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:6612")

# Worker configuration
# Recommended: 2-4 * CPU cores
# For IO-bound workloads (e.g. LLM API calls), you may increase this.
workers = int(os.getenv("WORKERS", multiprocessing.cpu_count() * 2 + 1))

# Use Uvicorn worker class (async)
worker_class = "uvicorn.workers.UvicornWorker"

# Threads per worker (Uvicorn worker does not use threads)
threads = 1

# Worker timeout (seconds)
# LLM requests may take longer; keep this reasonably high.
timeout = int(os.getenv("WORKER_TIMEOUT", "120"))

# Graceful shutdown timeout
graceful_timeout = 30

# Keep-alive timeout
keepalive = 5

# ============================================================================
# Process management
# ============================================================================

# Master PID file
pidfile = os.getenv("GUNICORN_PID_FILE", "/tmp/gunicorn-ai-server.pid")

# Run as daemon
daemon = False

# Worker restart policy
# Restart workers after N requests to mitigate memory leaks.
max_requests = int(os.getenv("MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("MAX_REQUESTS_JITTER", "50"))

# ============================================================================
# Logging
# ============================================================================

# Access log ("-" means stdout)
accesslog = os.getenv("ACCESS_LOG", "-")

# Error log ("-" means stderr)
errorlog = os.getenv("ERROR_LOG", "-")

# Log level
loglevel = os.getenv("LOG_LEVEL", "info")

# Access log format
access_log_format = (
    '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sμs'
)

# ============================================================================
# Tuning
# ============================================================================

# Socket backlog
backlog = int(os.getenv("BACKLOG", "2048"))

# Request body size limit (bytes)
# Default 10MB (useful for large LaTeX projects).
limit_request_body = int(os.getenv("LIMIT_REQUEST_BODY", str(10 * 1024 * 1024)))

# Request line length limit
limit_request_line = int(os.getenv("LIMIT_REQUEST_LINE", "8190"))

# Header count limit
limit_request_fields = int(os.getenv("LIMIT_REQUEST_FIELDS", "100"))

# Header field size limit
limit_request_field_size = int(os.getenv("LIMIT_REQUEST_FIELD_SIZE", "8190"))

# ============================================================================
# Lifecycle hooks
# ============================================================================


def on_starting(server):
    """Called when the master process starts."""
    print("=" * 60)
    print("Litewrite AI Server - Production Mode")
    print("=" * 60)
    print(f"Workers: {workers}")
    print(f"Bind: {bind}")
    print(f"Timeout: {timeout}s")
    print("=" * 60)


def on_reload(server):
    """Called when configuration reloads."""
    print("[Gunicorn] Reloading configuration...")


def worker_int(worker):
    """Called when a worker is interrupted (SIGINT/SIGQUIT)."""
    print(f"[Gunicorn] Worker {worker.pid} interrupted")


def worker_abort(worker):
    """Called when a worker aborts (SIGABRT)."""
    print(f"[Gunicorn] Worker {worker.pid} aborted")


def pre_fork(server, worker):
    """Called before forking a worker."""
    pass


def post_fork(server, worker):
    """Called after forking a worker."""
    print(f"[Gunicorn] Worker {worker.pid} spawned")


def pre_exec(server):
    """Called before a new master process execs (graceful reload)."""
    print("[Gunicorn] Forked child, re-executing...")


def when_ready(server):
    """Called when the server is ready to accept connections."""
    print("[Gunicorn] Server is ready. Accepting connections...")


def worker_exit(server, worker):
    """Called when a worker exits."""
    print(f"[Gunicorn] Worker {worker.pid} exited")


def nworkers_changed(server, new_value, old_value):
    """Called when the worker count changes."""
    print(f"[Gunicorn] Workers changed: {old_value} -> {new_value}")


def on_exit(server):
    """Called when the master process exits."""
    print("[Gunicorn] Shutting down...")
