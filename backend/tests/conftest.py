"""Shared pytest fixtures.

The environment is configured for SQLite *before* importing ``app`` because
``app.database`` resolves ``DB_DRIVER``/``DB_PATH`` at import time.
"""

import os
import tempfile
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="samurai-tests-"))
os.environ["DB_DRIVER"] = "sqlite"
os.environ["DB_PATH"] = str(_TMP_DIR / "samurai-test.db")
# Keep the limiter out of the way unless a test exercises it explicitly.
os.environ["SAMURAI_RATE_LIMIT_MAX"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import database, models  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def db_session():
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def clean_database():
    """Remove all rows after every test so tests stay independent."""
    yield
    session = database.SessionLocal()
    try:
        session.query(models.Finding).delete()
        session.query(models.DiscoveredLink).delete()
        session.query(models.Scan).delete()
        session.commit()
    finally:
        session.close()


@pytest.fixture()
def seeded_scan(db_session):
    """One scan with one discovered link, two global findings and one link finding."""
    scan = models.Scan(domain_target="example.com", status="COMPLETED", scan_type="port_scan:quick")
    db_session.add(scan)
    db_session.commit()
    db_session.refresh(scan)

    link = models.DiscoveredLink(
        scan_id=scan.id,
        url="http://example.com/",
        status_code=200,
        content_type="text/html",
    )
    db_session.add(link)
    db_session.commit()
    db_session.refresh(link)

    db_session.add_all([
        models.Finding(
            scan_id=scan.id,
            severity="info",
            finding_type="OPEN_PORT",
            description="22/tcp open ssh",
            poc_payload="port=22\nprotocol=tcp\nservice=ssh\nversion=OpenSSH 9.6",
        ),
        models.Finding(
            scan_id=scan.id,
            severity="low",
            finding_type="CONTACT_INFO_DISCLOSURE",
            description="Contact data discovered in page content.",
            cvss_score="2.3",
            poc_payload="URL: http://example.com/\nEmails:\n- test@example.com",
        ),
        models.Finding(
            scan_id=scan.id,
            link_id=link.id,
            severity="medium",
            finding_type="INSECURE_COOKIE",
            description="Cookie is missing critical security flags.",
            cvss_score="5.3",
            poc_payload="URL: http://example.com/",
        ),
    ])
    db_session.commit()
    db_session.refresh(scan)

    return scan
