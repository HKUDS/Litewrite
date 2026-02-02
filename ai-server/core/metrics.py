"""
Simple metrics collector
========================

A lightweight Prometheus-compatible metrics collector.

In production, consider using prometheus-fastapi-instrumentator.
"""

import time


class SimpleMetrics:
    """Simple metrics collector."""

    def __init__(self):
        self.request_count = 0
        self.error_count = 0
        self.total_latency_ms = 0.0
        self.start_time = time.time()

    def record_request(self, latency_ms: float, is_error: bool = False):
        """
        Record a request.

        Args:
            latency_ms: Request latency (ms)
            is_error: Whether this is an error response (status >= 400)
        """
        self.request_count += 1
        self.total_latency_ms += latency_ms
        if is_error:
            self.error_count += 1

    @property
    def avg_latency_ms(self) -> float:
        if self.request_count == 0:
            return 0.0
        return self.total_latency_ms / self.request_count

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self.start_time

    def to_prometheus(self) -> str:
        """Render metrics in Prometheus text format."""
        lines = [
            "# HELP ai_server_requests_total Total number of requests",
            "# TYPE ai_server_requests_total counter",
            f"ai_server_requests_total {self.request_count}",
            "",
            "# HELP ai_server_errors_total Total number of errors",
            "# TYPE ai_server_errors_total counter",
            f"ai_server_errors_total {self.error_count}",
            "",
            "# HELP ai_server_latency_avg_ms Average request latency in milliseconds",
            "# TYPE ai_server_latency_avg_ms gauge",
            f"ai_server_latency_avg_ms {self.avg_latency_ms:.2f}",
            "",
            "# HELP ai_server_uptime_seconds Server uptime in seconds",
            "# TYPE ai_server_uptime_seconds gauge",
            f"ai_server_uptime_seconds {self.uptime_seconds:.0f}",
        ]
        return "\n".join(lines)


# Global metrics instance
metrics = SimpleMetrics()


__all__ = ["SimpleMetrics", "metrics"]
