"""In-process middleware for the Samurai API.

Rate limiting is intentionally simple (sliding window per client IP) and has no
external dependency: local-first deployments must work without Redis.
"""

from __future__ import annotations

import os
import time
from typing import Iterable

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


def rate_limit_max() -> int:
    """Configured requests-per-window budget (0 disables the limiter)."""
    try:
        return int(os.getenv("SAMURAI_RATE_LIMIT_MAX", "120"))
    except ValueError:
        return 120


def rate_limit_window() -> float:
    try:
        return max(1.0, float(os.getenv("SAMURAI_RATE_LIMIT_WINDOW", "60")))
    except ValueError:
        return 60.0


class RateLimitMiddleware:
    """Sliding-window rate limiter keyed by ``scope["client"]`` address."""

    def __init__(
        self,
        app: ASGIApp,
        max_requests: int | None = None,
        window_seconds: float | None = None,
        exempt_paths: Iterable[str] = ("/api/health",),
    ) -> None:
        self.app = app
        self.max_requests = rate_limit_max() if max_requests is None else max_requests
        self.window_seconds = rate_limit_window() if window_seconds is None else window_seconds
        self.exempt_paths = set(exempt_paths)
        self._buckets: dict[str, list[float]] = {}

    def _client_key(self, scope: Scope) -> str:
        client = scope.get("client")
        if client and client[0]:
            return str(client[0])
        return "unknown"

    def _is_limited(self, key: str, now: float) -> bool:
        if self.max_requests <= 0:
            return False

        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = []
            self._buckets[key] = bucket

        cutoff = now - self.window_seconds
        if bucket and bucket[0] < cutoff:
            # Drop everything outside the window in one slice.
            first_valid = 0
            for index, timestamp in enumerate(bucket):
                if timestamp >= cutoff:
                    first_valid = index
                    break
            else:
                first_valid = len(bucket)
            del bucket[:first_valid]

        if len(bucket) >= self.max_requests:
            return True

        bucket.append(now)

        # Opportunistic pruning so abandoned clients do not leak memory.
        if len(self._buckets) > 4096:
            self._buckets = {
                ip: stamps[-1:] for ip, stamps in self._buckets.items() if stamps and stamps[-1] >= cutoff
            }

        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path in self.exempt_paths or self.max_requests <= 0:
            await self.app(scope, receive, send)
            return

        now = time.monotonic()
        key = self._client_key(scope)
        if self._is_limited(key, now):
            response = JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": f"Rate limit exceeded ({self.max_requests} requests per {int(self.window_seconds)}s).",
                        "detail": {"limit": self.max_requests, "window_seconds": self.window_seconds},
                        "retryable": True,
                    }
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
