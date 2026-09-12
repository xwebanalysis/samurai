# Samurai Development Roadmap

This document tracks the strategic steps required to evolve the Samurai application into a full-scale web cybersecurity suite. 
This file is formatted to be synced automatically with GitHub Issues using the `xgh` roadmap standard.

## Local-First Hardening (XWA Phase 2) <!-- phase:local-first -->

- [x] Dual database architecture: `DB_DRIVER=sqlite|postgresql` with SQLite default, `DB_PATH`, WAL + `foreign_keys` + `busy_timeout` (#30)
- [x] Remove Redis and Celery from requirements, docker-compose, scripts and docs (no backend code used them) (#31)
- [x] Refresh Python dependencies to current pinned versions on Python 3.13 (fastapi 0.141, SQLAlchemy 2.0.52, cryptography 50, playwright 1.62…) (#32)
- [x] `requirements-dev.txt` with pytest / pytest-asyncio / anyio; optional `requirements-postgres.txt` (#33)
- [x] FastAPI `lifespan`, `GET /api/health`, env-configurable CORS (`XWA_CORS_ORIGINS`) and in-process rate limiting (#34)
- [x] xwa-sdk unified aliases: `GET/DELETE /api/analyses`, `GET /api/analyses/{id}/export?format=json|csv` (#35)
- [x] WebSocket protocol migrated to xwa-sdk `Event` envelopes on the 3 live endpoints (#36)
- [x] Explicit timeouts + terminate/kill for sqlmap and nuclei subprocesses (#37)
- [x] Backend pytest suite (health, CRUD, exports V1, parsers, events, rate limit, timeouts) — 33 tests green (#38)
- [x] `samurai.sh local` as default (SQLite, no Docker), `docker` mode with DB_DRIVER=postgresql; `clean.sh` preserves package-lock (#39)
- [x] Frontend `environment.ts`/`environment.development.ts`, real `favicon.ico`, `npm start` on 0.0.0.0, broken `ng test` removed (#40)
- [x] Docs updated: README, manual, python-libraries, ui-architecture, roadmap (#41)

## Infrastructure & Core Initialization <!-- phase:infrastructure -->

- [x] Dockerize frontend (Angular) and backend (FastAPI) environments (#1)
- [x] Integrate PostgreSQL and Redis architectures for persistence (#2) — *Redis retired in the local-first phase; PostgreSQL remains optional via `DB_DRIVER=postgresql`*
- [x] Implement the Nothing Design System UI tokens and layout (#3)
- [x] Configure Docker-compose for rapid local development (HMR Support) (#4)

## Real-time Scanning Engine <!-- phase:real-time-engine -->

- [x] Scaffold SQLAlchemy models for Scans and Findings (#5)
- [x] Create WebSocket endpoints for real-time console streaming (#6)
- [x] Integrate native Nmap execution as an asynchronous Python subprocess (#7)
- [x] Build the "Nothing Terminal" component in Angular to render WebSocket streams (#8)

## Deep Vulnerability Analysis Integration <!-- phase:vuln-analysis -->

- [x] Integrate SQLMap subprocess runner for automated SQL Injection vulnerability checks (#9)
- [x] Connect Nuclei vulnerability scanner templates to expand the footprint engine (#10)
- [/] Implement robust `stdout` parsing heuristics for automated Finding severity classification (#11)
- [/] Establish asynchronous fuzzing for directory and file brute-forcing (#12)

## Headless Reconnaissance & Crawling <!-- phase:recon-crawler -->

- [/] Add headless browser nodes (Playwright) to execute JavaScript-heavy reconnaissance (#13)
- [/] Intercept, capture, and analyze XHR/Fetch network requests dynamically (#14)
- [x] Implement visual screenshot capture module for successfully resolved domains (#15)
- [x] Automate Site Topology mapping through recursive spider crawling (#16)

## Security, Auth & Production Hardening <!-- phase:production-hardening -->

- [/] Wrap FastAPI backend routes with JWT Authentication middleware (#17)
- [/] Add RBAC (Role-Based Access Control) to restrict scan actions by user level (#18)
- [ ] Implement Redis-based rate limiting to prevent application scan flooding (#19) — *superseded by the in-process limiter delivered in #34; a proxy-level shared limiter remains for multi-worker production*
- [ ] Setup scheduled recurrent scans via Celery Beat tasks (#20) — *deferred; task queue intentionally removed for local-first*
- [x] Develop exportable Executive Reports (PDF and CSV format) for compiled findings (#21)

## Frontend Angular 22 + Nothing Design <!-- phase:angular22-nothing -->

- [x] Upgrade Angular 21 → 22 (`@angular/build`, TypeScript 6, Vitest unit tests) — `@angular/build:application`/`:unit-test`, zoneless (`provideZonelessChangeDetection`), Node 24, reproducible `npm ci`
- [x] Self-host Doto / Space Grotesk / Space Mono fonts (remove Google Fonts runtime dependency) — `public/fonts/*.woff2` + `src/_fonts.scss`
- [x] Tokenize `--gold` and consolidate Nothing Design tokens across apps — 5 hardcoded `#FFD700` removed, flat surfaces (no gradient), no shadows/skeletons
- [x] Restore a working frontend test script (Vitest) once the Angular 22 upgrade lands — 28 tests green (`npm test`)
- [x] Restructure to `core/` (ApiService, unified LiveService, theme, i18n) + `shared/` (terminal, metric-card, status-badge, export-actions, findings-list) + `features/`
- [x] Centralize every REST call in `ApiService` and verify the three WS streams against the backend `Event` payloads (`events.py`, `scanner.py`, `crawler.py`, `recon/`)
