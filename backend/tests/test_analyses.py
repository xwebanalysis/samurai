"""CRUD + export tests for the unified /api/analyses endpoints."""

from app import models


def test_list_analyses_unified_shape(client, seeded_scan):
    response = client.get("/api/analyses")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    item = items[0]
    assert item["id"] == str(seeded_scan.id)
    assert item["tool"] == "samurai"
    assert item["tool_version"] == "2.5.0"
    assert item["target"] == "example.com"
    assert item["status"] == "COMPLETED"
    assert item["analysis_type"] == "port_scan:quick"
    assert item["created_at"]


def test_get_analysis_with_detail(client, seeded_scan):
    response = client.get(f"/api/analyses/{seeded_scan.id}")
    assert response.status_code == 200
    detail = response.json()
    assert detail["id"] == str(seeded_scan.id)
    assert len(detail["findings"]) == 3
    assert len(detail["discovered_links"]) == 1
    assert len(detail["discovered_links"][0]["findings"]) == 1


def test_get_missing_analysis_returns_404_envelope(client):
    response = client.get("/api/analyses/999999")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_delete_analysis_cascades(client, db_session, seeded_scan):
    scan_id = seeded_scan.id
    response = client.delete(f"/api/analyses/{scan_id}")
    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "analysis_id": str(scan_id)}

    db_session.expire_all()
    assert db_session.query(models.Scan).filter(models.Scan.id == scan_id).first() is None
    assert db_session.query(models.Finding).filter(models.Finding.scan_id == scan_id).count() == 0
    assert db_session.query(models.DiscoveredLink).filter(models.DiscoveredLink.scan_id == scan_id).count() == 0

    assert client.get(f"/api/analyses/{scan_id}").status_code == 404


def test_legacy_scan_endpoints_still_work(client, seeded_scan):
    assert client.get("/api/scans").status_code == 200
    assert len(client.get("/api/scans").json()) == 1
    detail = client.get(f"/api/scans/{seeded_scan.id}")
    assert detail.status_code == 200
    assert detail.json()["domain_target"] == "example.com"
    assert client.delete(f"/api/scans/{seeded_scan.id}").status_code == 200


def test_export_analysis_json(client, seeded_scan):
    response = client.get(f"/api/analyses/{seeded_scan.id}/export?format=json")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert f"samurai-analysis-{seeded_scan.id}.json" in response.headers["content-disposition"]
    payload = response.json()
    assert payload["id"] == str(seeded_scan.id)
    assert len(payload["findings"]) == 3


def test_export_analysis_csv(client, seeded_scan):
    response = client.get(f"/api/analyses/{seeded_scan.id}/export?format=csv")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert f"samurai-analysis-{seeded_scan.id}.csv" in response.headers["content-disposition"]
    lines = response.text.strip().splitlines()
    assert lines[0] == (
        "analysis_id,target,link_id,url,status_code,finding_type,severity,cvss_score,description,poc_payload"
    )
    assert any("OPEN_PORT" in line for line in lines)
    assert any("INSECURE_COOKIE" in line for line in lines)


def test_export_analysis_rejects_unknown_format(client, seeded_scan):
    response = client.get(f"/api/analyses/{seeded_scan.id}/export?format=xml")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"
