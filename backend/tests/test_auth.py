"""Optional JWT auth + RBAC tests.

Auth is off by default; these tests flip ``SAMURAI_JWT_SECRET`` with
``monkeypatch`` and restore it afterwards.
"""

import os
from types import SimpleNamespace

import pytest

from app import auth


@pytest.fixture()
def auth_env(monkeypatch):
    monkeypatch.setenv("SAMURAI_JWT_SECRET", "test-secret-0123456789abcdef0123456789abcdef")
    monkeypatch.setenv("SAMURAI_ADMIN_PASSWORD", "admin123")
    yield
    monkeypatch.delenv("SAMURAI_JWT_SECRET", raising=False)
    monkeypatch.delenv("SAMURAI_ADMIN_PASSWORD", raising=False)


def test_login_rejected_when_auth_disabled(client):
    response = client.post("/api/auth/login", json={"password": "changeme"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"


def test_login_wrong_password(auth_env, client):
    response = client.post("/api/auth/login", json={"password": "wrong"})
    assert response.status_code == 401


def test_login_issues_token(auth_env, client):
    response = client.post("/api/auth/login", json={"password": "admin123"})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["role"] == "admin"
    claims = auth.decode_token(body["token"])
    assert claims is not None
    assert claims["role"] == "admin"


def test_missing_token_rejected_when_enabled(auth_env, client):
    response = client.get("/api/scans")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_invalid_token_rejected(auth_env, client):
    response = client.get("/api/scans", headers={"Authorization": "Bearer not-a-token"})
    assert response.status_code == 401


def test_health_stays_exempt(auth_env, client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["auth_enabled"] is True


def test_valid_token_allows_reads(auth_env, client, seeded_scan):
    token = auth.create_access_token(subject="admin", role="admin")
    response = client.get("/api/scans", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_analyst_can_read(auth_env, client, seeded_scan):
    token = auth.create_access_token(subject="analyst", role="analyst")
    response = client.get(f"/api/scans/{seeded_scan.id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_analyst_denied_on_delete(auth_env, client, seeded_scan):
    token = auth.create_access_token(subject="analyst", role="analyst")
    response = client.delete(f"/api/scans/{seeded_scan.id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_analyst_denied_on_cancel(auth_env, client):
    token = auth.create_access_token(subject="analyst", role="analyst")
    response = client.post("/api/scan/cancel/1", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_analyst_denied_on_database_export(auth_env, client):
    token = auth.create_access_token(subject="analyst", role="analyst")
    response = client.get("/api/database/export/raw", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_admin_allowed_on_delete(auth_env, client, seeded_scan):
    token = auth.create_access_token(subject="admin", role="admin")
    response = client.delete(f"/api/scans/{seeded_scan.id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_admin_allowed_on_database_export(auth_env, client):
    token = auth.create_access_token(subject="admin", role="admin")
    response = client.get("/api/database/export/raw", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_token_query_param_accepted(auth_env, client, seeded_scan):
    token = auth.create_access_token(subject="admin", role="admin")
    response = client.get(f"/api/analyses?token={token}")
    assert response.status_code == 200


async def test_websocket_token_validation(auth_env, monkeypatch):
    assert auth.auth_enabled()

    class FakeWS:
        def __init__(self, token):
            self.query_params = {"token": token} if token is not None else {}

    assert await auth.websocket_require_user(FakeWS("bogus")) is False
    assert await auth.websocket_require_user(FakeWS(None)) is False

    token = auth.create_access_token(subject="admin", role="admin")
    assert await auth.websocket_require_user(FakeWS(token)) is True

    monkeypatch.delenv("SAMURAI_JWT_SECRET")
    assert await auth.websocket_require_user(FakeWS(None)) is True
