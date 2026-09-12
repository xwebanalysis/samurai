"""Health, root and error-envelope contract tests."""

from app.main import APP_VERSION


def test_root_contract(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "samurai"
    assert body["tool"] == "samurai"
    assert body["version"] == APP_VERSION


def test_health_contract(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "status": "ok",
        "database": "ok",
        "version": APP_VERSION,
        "tool": "samurai",
    }


def test_health_exempt_from_rate_limit(client):
    for _ in range(5):
        assert client.get("/api/health").status_code == 200


def test_not_found_uses_unified_error_envelope(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert isinstance(error["message"], str)
    assert error["retryable"] is False


def test_database_is_sqlite_with_pragmas():
    from sqlalchemy import text

    from app import database

    assert database.DB_DRIVER == "sqlite"
    assert database.engine.dialect.name == "sqlite"

    with database.engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert conn.execute(text("PRAGMA busy_timeout")).scalar() == 5000
