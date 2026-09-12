"""Rate limiter middleware unit tests (isolated app, no main app state)."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware import RateLimitMiddleware


def _build_app(max_requests: int = 2) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, max_requests=max_requests, window_seconds=60)

    @app.get("/api/probe")
    def probe():
        return {"ok": True}

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app


def test_rate_limit_blocks_after_budget():
    with TestClient(_build_app(max_requests=2)) as client:
        assert client.get("/api/probe").status_code == 200
        assert client.get("/api/probe").status_code == 200

        blocked = client.get("/api/probe")
        assert blocked.status_code == 429
        error = blocked.json()["error"]
        assert error["code"] == "RATE_LIMITED"
        assert error["retryable"] is True
        assert error["detail"]["limit"] == 2


def test_health_is_exempt_from_rate_limit():
    with TestClient(_build_app(max_requests=1)) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/probe").status_code == 200
        assert client.get("/api/probe").status_code == 429


def test_disabled_rate_limit_always_allows():
    with TestClient(_build_app(max_requests=0)) as client:
        for _ in range(10):
            assert client.get("/api/probe").status_code == 200
