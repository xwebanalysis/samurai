# Librerías Python Usadas en el Backend de Samurai

Última actualización: 2026-09-12

## Alcance

Este documento lista las librerías Python usadas por el backend en `samurai/backend`, según:

- `samurai/backend/requirements.txt` (runtime, SQLite primero)
- `samurai/backend/requirements-postgres.txt` (driver PostgreSQL opcional)
- `samurai/backend/requirements-dev.txt` (herramientas de test)
- importaciones directas en `samurai/backend/app/**/*.py`
- comando de arranque en `samurai/backend/Dockerfile`

Runtime objetivo: **Python 3.13** (gestionado con `uv`). Todas las versiones de runtime
están fijadas y verificadas con `pip install -r requirements.txt -r requirements-dev.txt` en CPython 3.13.15.

## Dependencias de Runtime

| Librería | Versión | Propósito Principal | Dónde se Usa |
|---|---:|---|---|
| fastapi | 0.141.1 | Framework API, endpoints REST + WebSocket, lifespan | `app/main.py`, `app/scanner.py`, `app/crawler.py`, `app/recon/*` |
| uvicorn[standard] | 0.52.4 | Servidor ASGI (`uvicorn app.main:app`) | `backend/Dockerfile`, `samurai.sh` |
| SQLAlchemy | 2.0.52 | ORM, sesiones, motor, soporte de doble driver | `app/database.py`, `app/models.py`, `app/main.py` |
| pydantic | 2.13.5 | Validación de modelos (núcleo de FastAPI) | Dependencia runtime de FastAPI |
| requests | 2.34.2 | Sondeos HTTP síncronos para módulos de escaneo/crawl | `app/scanner.py`, `app/crawler.py` |
| beautifulsoup4 | 4.15.0 | Parseo HTML y extracción de formularios/DOM | `app/scanner.py`, `app/crawler.py` |
| httpx | 0.28.1 | Cliente HTTP asíncrono para módulos de reconocimiento | `app/recon/modules/api_discovery.py`, `security_headers.py`, `subdomain_enumerator.py`, `technology_stack.py` |
| dnspython | 2.8.0 | Resolución DNS para módulos de reconocimiento | `app/recon/modules/dns_enumerator.py`, `subdomain_enumerator.py` |
| tldextract | 5.3.2 | Extracción de dominio registrable para subdominios | `app/recon/modules/subdomain_enumerator.py` |
| cryptography | 50.0.1 | AES-256-GCM + PBKDF2 para la exportación cifrada (`SAMURAI_DB_EXPORT_V1`) | `app/db_exporter.py` |
| playwright | 1.62.0 | Navegador headless para análisis JS en runtime (opcional) | `app/crawler.py` (`from playwright.async_api import async_playwright`) |

### Driver PostgreSQL Opcional

| Librería | Versión | Propósito |
|---|---:|---|
| psycopg2-binary | 2.9.13 | Driver PostgreSQL, solo con `DB_DRIVER=postgresql` (`requirements-postgres.txt`) |

### Binding xwa-sdk Opcional (no está en requirements.txt)

| Librería | Fuente | Propósito |
|---|---|---|
| xwa-sdk | `-e ../../xwa-sdk/bindings/python` (local) o `git+https://github.com/xwebanalysis/xwa-sdk.git#subdirectory=bindings/python` | Dataclasses canónicas `Event`/`Analysis` usadas por `app/events.py`. El backend tiene un fallback estructuralmente idéntico. |

## Dependencias de Test/Desarrollo

`requirements-dev.txt`, instalado sobre el fichero de runtime:

| Librería | Versión | Propósito |
|---|---:|---|
| pytest | 9.1.1 | Runner de tests (`backend/tests/`) |
| pytest-asyncio | 1.4.0 | `asyncio_mode = auto` para tests asíncronos |
| anyio | 4.15.1 | Integración asíncrona en tests (también usado por Starlette TestClient) |

## Dependencias Eliminadas

Las siguientes estaban declaradas en el antiguo requirements pero **no tenían importaciones** o
se sustituyeron con la arquitectura local-first:

- `celery`, `redis` — nunca se usaron en el código; se eliminaron de scripts y compose.
- `aiohttp` — sin importaciones directas (recon usa `httpx`).
- `python-whois`, `certifi` — sin importaciones directas.
- `psycopg2-binary` — ya no está en el fichero base; se movió a `requirements-postgres.txt`.
