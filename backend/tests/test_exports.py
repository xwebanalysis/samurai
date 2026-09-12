"""Database export tests: raw JSON, encrypted AES-256-GCM roundtrip (V1)."""

import json

import pytest

from app import db_exporter


def test_export_raw_payload(client, seeded_scan):
    response = client.get("/api/database/export/raw")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    payload = response.json()
    assert set(payload) == {"export_metadata", "scans"}
    assert payload["export_metadata"]["scan_count"] == 1
    assert payload["export_metadata"]["samurai_version"] == "2.5.0"
    assert payload["scans"][0]["id"] == seeded_scan.id
    assert len(payload["scans"][0]["findings"]) == 3


def test_encrypted_roundtrip_uses_v1_format():
    payload = {
        "export_metadata": {"samurai_version": "2.5.0"},
        "scans": [{"id": 1, "domain_target": "example.com", "findings": [], "discovered_links": []}],
    }
    encrypted = db_exporter.encrypt_export_payload(payload, "test1234")

    assert encrypted.startswith(b"SAMURAI_DB_EXPORT_V1")
    # header (21) + salt (16) + nonce (12) + at least one ciphertext byte
    assert len(encrypted) > 21 + 16 + 12

    assert db_exporter.decrypt_export_payload(encrypted, "test1234") == payload

    with pytest.raises(Exception):
        db_exporter.decrypt_export_payload(encrypted, "wrong-password")

    with pytest.raises(ValueError):
        db_exporter.decrypt_export_payload(b"NOTSAMURAI" + encrypted[10:], "test1234")


def test_encrypted_export_endpoint(client, seeded_scan):
    response = client.post("/api/database/export/encrypted", json={"password": "test1234"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.content.startswith(b"SAMURAI_DB_EXPORT_V1")

    decrypted = db_exporter.decrypt_export_payload(response.content, "test1234")
    assert decrypted["export_metadata"]["scan_count"] == 1
    assert decrypted["scans"][0]["domain_target"] == "example.com"
    json.dumps(decrypted)


def test_encrypted_export_requires_password(client):
    response = client.post("/api/database/export/encrypted", json={"password": "abc"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"
