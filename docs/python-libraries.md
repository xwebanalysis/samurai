# Python Libraries Used in Samurai Backend

Last update: 2026-09-12

## Scope

This document lists the Python libraries used by the backend in `samurai/backend`, based on:

- `samurai/backend/requirements.txt` (runtime, SQLite-first)
- `samurai/backend/requirements-postgres.txt` (optional PostgreSQL driver)
- `samurai/backend/requirements-dev.txt` (test tooling)
- direct imports in `samurai/backend/app/**/*.py`
- runtime startup command in `samurai/backend/Dockerfile`

Target runtime: **Python 3.13** (managed with `uv`). All runtime pins are exact and
verified with `pip install -r requirements.txt -r requirements-dev.txt` on CPython 3.13.15.

## Runtime Dependencies

| Library | Version | Main Purpose | Where It Is Used |
|---|---:|---|---|
| fastapi | 0.141.1 | API framework, REST + WebSocket endpoints, lifespan | `app/main.py`, `app/scanner.py`, `app/crawler.py`, `app/recon/*` |
| uvicorn[standard] | 0.52.4 | ASGI server (`uvicorn app.main:app`) | `backend/Dockerfile`, `samurai.sh` |
| SQLAlchemy | 2.0.52 | ORM, sessions, engine, dual-driver support | `app/database.py`, `app/models.py`, `app/main.py` |
| pydantic | 2.13.5 | Request/response models (FastAPI core validation) | FastAPI runtime dependency |
| requests | 2.34.2 | Synchronous HTTP probes for scan/crawl modules | `app/scanner.py`, `app/crawler.py` |
| beautifulsoup4 | 4.15.0 | HTML parsing, form/DOM extraction | `app/scanner.py`, `app/crawler.py` |
| httpx | 0.28.1 | Async HTTP client for recon modules | `app/recon/modules/api_discovery.py`, `security_headers.py`, `subdomain_enumerator.py`, `technology_stack.py` |
| dnspython | 2.8.0 | DNS resolution for recon modules | `app/recon/modules/dns_enumerator.py`, `subdomain_enumerator.py` |
| tldextract | 5.3.2 | Registrable-domain extraction for subdomain logic | `app/recon/modules/subdomain_enumerator.py` |
| cryptography | 50.0.1 | AES-256-GCM + PBKDF2 for encrypted DB export (`SAMURAI_DB_EXPORT_V1`) | `app/db_exporter.py` |
| playwright | 1.62.0 | Headless browser runtime analysis for JS surface mapping (optional at runtime) | `app/crawler.py` (`from playwright.async_api import async_playwright`) |

### Optional PostgreSQL Driver

| Library | Version | Purpose |
|---|---:|---|
| psycopg2-binary | 2.9.13 | PostgreSQL driver, only when `DB_DRIVER=postgresql` (`requirements-postgres.txt`) |

### Optional xwa-sdk Binding (not in requirements.txt)

| Library | Source | Purpose |
|---|---|---|
| xwa-sdk | `-e ../../xwa-sdk/bindings/python` (local) or `git+https://github.com/xwebanalysis/xwa-sdk.git#subdirectory=bindings/python` | Canonical `Event`/`Analysis` dataclasses used by `app/events.py`. The backend has a structurally identical fallback if the package is absent. |

## Test/Development Dependencies

`requirements-dev.txt`, installed on top of the runtime file:

| Library | Version | Purpose |
|---|---:|---|
| pytest | 9.1.1 | Test runner (`backend/tests/`) |
| pytest-asyncio | 1.4.0 | `asyncio_mode = auto` for async tests (subprocess helper) |
| anyio | 4.15.1 | Async test/back-end integration (also used by Starlette TestClient) |

## Removed Dependencies

The following were declared in the old requirements file but had **no imports** or were
replaced by the local-first architecture:

- `celery`, `redis` — never used by backend code; the task queue and Redis were removed from scripts/compose.
- `aiohttp` — no direct imports (recon uses `httpx`).
- `python-whois`, `certifi` — no direct imports.
- `psycopg2-binary` — no longer in the base file; moved to `requirements-postgres.txt`.

`websockets` (provided by `uvicorn[standard]`) is not required by the test suite; the
WebSocket tests use Starlette's `TestClient` with ASGI transport.
