
<h1 align="center">Samurai</h1>

<div align="center">
<img src="https://raw.githubusercontent.com/xscriptor/xassets/main/xwa/samurai/samurai-colors.svg" width="120"/> 
</div>

**Language / Idioma**  
[English](#) | [Español](./docs/esp/README.md)

<p><em><a href="https://github.com/xwebanalysis/samurai">Samurai</a></em> : <em><a href="https://github.com/xwebanalysis/meta">XWA</a>  <strong>submodule focused</strong> on web cybersecurity — under active development</em></p>

<img src="https://raw.githubusercontent.com/xscriptor/xassets/main/xwa/samurai/samurai-xwa-screenshot-01.png" alt="Samurai XWA Screenshot 01" width="100%">

<details>
  <summary>More screenshots...</summary>
  <br>
  <img src="https://raw.githubusercontent.com/xscriptor/xassets/main/xwa/samurai/samurai-xwa-screenshot-02.png" alt="Samurai XWA Screenshot 02" width="100%">
  <br>
  <img src="https://raw.githubusercontent.com/xscriptor/xassets/main/xwa/samurai/samurai-xwa-screenshot-03.png" alt="Samurai XWA Screenshot 03" width="100%">
  <br>
  <img src="https://raw.githubusercontent.com/xscriptor/xassets/main/xwa/samurai/samurai-xwa-screenshot-04.png" alt="Samurai XWA Screenshot 04" width="100%">
  <br>
  <img src="https://raw.githubusercontent.com/xscriptor/xassets/main/xwa/samurai/samurai-xwa-screenshot-05.png" alt="Samurai XWA Screenshot 05" width="100%">
</details>

<hr>

<h2>Overview</h2>

<p>Samurai is a cybersecurity analysis platform with two interfaces sharing the same database:</p>

<table>
  <tr>
    <th>Interface</th>
    <th>Directory</th>
    <th>Language</th>
    <th>Type</th>
  </tr>
  <tr>
    <td><strong>Samurai Web</strong></td>
    <td><code>/frontend</code> + <code>/backend</code></td>
    <td>Angular 22 + FastAPI/Python 3.13</td>
    <td>Web application (<strong>100% local, SQLite by default</strong>)</td>
  </tr>
  <tr>
    <td><strong>Samurai TUI</strong></td>
    <td><code>/samurai-tui</code></td>
    <td>Rust</td>
    <td>Terminal application (standalone or Docker)</td>
  </tr>
</table>

<h3>Capabilities</h3>
<ul>
  <li><strong>Port Scanning</strong> — Nmap with configurable profiles (quick, balanced, deep, UDP)</li>
  <li><strong>Web Reconnaissance</strong> — DNS enumeration, subdomain discovery, API probing, security headers audit, technology fingerprinting</li>
  <li><strong>Vulnerability Crawling (DAST)</strong> — Page discovery, HTTP header analysis, CORS/cookie/JS-secret checks, optional SQLMap and Nuclei modules with explicit timeouts</li>
  <li><strong>Database Export</strong> — Full analytics dump as JSON (raw) or AES-256-GCM encrypted binary (<code>SAMURAI_DB_EXPORT_V1</code>)</li>
  <li><strong>History & Archive</strong> — Persistent scan storage with findings and discovered topology</li>
  <li><strong>Unified API</strong> — <code>xwa-sdk</code> envelopes: <code>Analysis</code> responses and <code>Event</code> WebSocket streams</li>
</ul>

<hr>

<h2>Quick Start (Local — SQLite, no Docker)</h2>

<p>Requirements: <strong>Python 3.13</strong> (<a href="https://docs.astral.sh/uv/">uv</a> recommended) and <strong>Node 24</strong>. External scanners (<code>nmap</code>, <code>sqlmap</code>, <code>nuclei</code>) are optional — missing binaries are reported as <code>DEPENDENCY_MISSING</code> instead of crashing.</p>

<pre><code># From the samurai repository root
./samurai.sh          # same as: ./samurai.sh local</code></pre>

<p>The script creates <code>backend/.venv</code> with uv (Python 3.13), installs the local <code>xwa-sdk</code> binding when present, installs requirements, and starts:</p>

<table>
  <tr><th>Service</th><th>URL</th></tr>
  <tr><td>Frontend (Angular)</td><td><code>http://localhost:4200</code></td></tr>
  <tr><td>Backend (FastAPI)</td><td><code>http://localhost:8000</code> — docs at <code>/docs</code></td></tr>
  <tr><td>Health</td><td><code>http://localhost:8000/api/health</code></td></tr>
  <tr><td>SQLite database</td><td><code>&lt;repo&gt;/samurai.db</code></td></tr>
</table>

<h3>Manual backend start</h3>
<pre><code>cd backend
~/.local/bin/uv venv --python 3.13 --seed .venv
.venv/bin/pip install -r requirements.txt
# Optional: local xwa-sdk binding (Event/Analysis dataclasses)
.venv/bin/pip install -e ../../xwa-sdk/bindings/python
.venv/bin/uvicorn app.main:app --port 8000</code></pre>

<h3>Manual frontend start</h3>
<pre><code>cd frontend
export PATH="$HOME/.local/share/mise/installs/node/24/bin:$PATH"
npm ci          # reproducible install from package-lock.json
npm start       # ng serve --host 0.0.0.0 --poll 2000
npm test        # Vitest via @angular/build:unit-test
npm run build   # @angular/build:application (production)</code></pre>

<h3>Docker (PostgreSQL)</h3>
<pre><code>./samurai.sh docker</code></pre>
<p>Compose starts frontend, backend (<code>DB_DRIVER=postgresql</code>) and PostgreSQL 17 with a healthcheck. Redis and Celery are no longer part of the stack.</p>

<h3>Cleanup (clean.sh)</h3>
<pre><code>./clean.sh</code></pre>
<p>Kills leftover processes, removes Docker containers/volumes/images, deletes <code>node_modules/</code>, <code>.venv</code>, <code>dist/</code>, Python cache, <code>.angular/</code> cache and the local <code>samurai.db*</code> files. <code>package-lock.json</code> is preserved.</p>

<hr>

<h2>Database Architecture (Dual: SQLite / PostgreSQL)</h2>

<ul>
  <li><code>DB_DRIVER=sqlite</code> (<strong>default</strong>) — local file database, zero external services. SQLite is opened with <code>check_same_thread=False</code> plus <code>PRAGMA foreign_keys=ON</code>, <code>journal_mode=WAL</code> and <code>busy_timeout=5000</code>.</li>
  <li><code>DB_DRIVER=postgresql</code> — optional; uses <code>DATABASE_URL</code> when set, otherwise <code>DB_HOST</code>/<code>DB_PORT</code>/<code>DB_NAME</code>/<code>DB_USER</code>/<code>DB_PASS</code>, with <code>pool_pre_ping=True</code>.</li>
  <li><code>DB_PATH</code> overrides the SQLite file location (default <code>&lt;repo&gt;/samurai.db</code>).</li>
  <li><code>wait_for_db()</code> retries only for PostgreSQL; SQLite connects immediately.</li>
</ul>

<p><strong>TUI compatibility:</strong> the table schema (<code>scans</code>, <code>discovered_links</code>, <code>findings</code>) and the encrypted export format (<code>SAMURAI_DB_EXPORT_V1</code>: header + 16-byte salt + 12-byte nonce + AES-256-GCM ciphertext, PBKDF2-SHA256 600k iterations) are frozen and shared with <code>samurai-tui</code>. Do not change column types or the header.</p>

<h2>WebSocket Event Protocol (xwa-sdk)</h2>

<p>The three live endpoints (<code>/api/scan/live</code>, <code>/api/vuln/live</code>, <code>/api/recon/live</code>) stream JSON <code>Event</code> envelopes instead of plain text:</p>

<pre><code>{
  "seq": 4,
  "type": "item_found",
  "tool": "samurai",
  "analysis_id": "42",
  "ts": "2026-09-12T10:00:04Z",
  "payload": {
    "kind": "open_port",
    "port": "22", "protocol": "tcp", "service": "ssh", "version": "OpenSSH 9.6",
    "severity": "info"
  }
}</code></pre>

<table>
  <tr><th>Event type</th><th>Payload</th></tr>
  <tr><td><code>analysis_started</code></td><td><code>{id, target, scan_type, profile?, modules?, timeout?}</code></td></tr>
  <tr><td><code>log</code></td><td><code>{line}</code> — one terminal line (raw nmap output included)</td></tr>
  <tr><td><code>analysis_progress</code></td><td><code>{phase, message, data?}</code> — e.g. contact intel with <code>data.url</code>/<code>emails_count</code>/<code>phones_count</code></td></tr>
  <tr><td><code>item_found</code></td><td>Finding or port: <code>{kind:"open_port", port, protocol, service, version, severity}</code>, <code>{kind:"unsanitized_input", url, forms}</code>, <code>{kind:"reflected_input", url}</code></td></tr>
  <tr><td><code>analysis_completed</code></td><td><code>{summary:{total_items, by_severity, ...}, status, scan_id, results?, ports?}</code></td></tr>
  <tr><td><code>analysis_error</code></td><td><code>{error:{code, message, detail, retryable}}</code></td></tr>
</table>

<p><code>seq</code> is monotonic per connection starting at 1 and <code>analysis_id</code> is always the persisted scan id serialized as a string. If the optional <code>xwa-sdk</code> Python package is not installed, the backend emits the exact same structure via a built-in fallback.</p>

<h2>REST API (selected)</h2>

<table>
  <tr><th>Method</th><th>Path</th><th>Description</th></tr>
  <tr><td>GET</td><td><code>/api/health</code></td><td><code>{status, database, version, tool}</code> (rate-limit exempt)</td></tr>
  <tr><td>GET</td><td><code>/api/scans</code>, <code>/api/scans/{id}</code></td><td>Legacy history endpoints (kept)</td></tr>
  <tr><td>GET/DELETE</td><td><code>/api/analyses</code>, <code>/api/analyses/{id}</code></td><td>Unified xwa-sdk <code>Analysis</code> aliases</td></tr>
  <tr><td>GET</td><td><code>/api/analyses/{id}/export?format=json|csv</code></td><td>Single-analysis export with <code>Content-Disposition</code></td></tr>
  <tr><td>GET</td><td><code>/api/database/export/raw</code></td><td>Full DB export (JSON)</td></tr>
  <tr><td>POST</td><td><code>/api/database/export/encrypted</code></td><td><code>{"password": "..."}</code> → AES-256-GCM binary (TUI-compatible)</td></tr>
</table>

<p>Errors use the unified envelope <code>{"error":{"code","message","detail","retryable"}}</code>. CORS is configurable via <code>XWA_CORS_ORIGINS</code> (comma-separated origins or regexes; default localhost/LAN) with <code>allow_credentials=False</code>. In-process rate limiting defaults to 120 req/min per IP (<code>SAMURAI_RATE_LIMIT_MAX</code>, window <code>SAMURAI_RATE_LIMIT_WINDOW</code> seconds; 0 disables).</p>

<h2>Environment Variables</h2>

<table>
  <tr><th>Variable</th><th>Default</th><th>Purpose</th></tr>
  <tr><td><code>DB_DRIVER</code></td><td><code>sqlite</code></td><td><code>sqlite</code> or <code>postgresql</code></td></tr>
  <tr><td><code>DB_PATH</code></td><td><code>&lt;repo&gt;/samurai.db</code></td><td>SQLite file path</td></tr>
  <tr><td><code>DATABASE_URL</code></td><td>—</td><td>PostgreSQL URL (overrides DB_* parts)</td></tr>
  <tr><td><code>DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS</code></td><td><code>localhost/5432/samurai/postgres/postgres</code></td><td>PostgreSQL parts</td></tr>
  <tr><td><code>XWA_CORS_ORIGINS</code></td><td>localhost/LAN regex</td><td>Allowed origins (comma-separated)</td></tr>
  <tr><td><code>SAMURAI_RATE_LIMIT_MAX</code></td><td><code>120</code></td><td>Requests per window per IP (0 disables)</td></tr>
  <tr><td><code>SAMURAI_RATE_LIMIT_WINDOW</code></td><td><code>60</code></td><td>Rate-limit window in seconds</td></tr>
  <tr><td><code>SAMURAI_JWT_SECRET</code></td><td>—</td><td>Enables JWT auth + RBAC when set (POST <code>/api/auth/login</code> issues tokens; WebSockets take <code>?token=</code>)</td></tr>
  <tr><td><code>SAMURAI_ADMIN_PASSWORD</code></td><td><code>changeme</code></td><td>Admin password for <code>/api/auth/login</code> (role <code>admin</code>; analysts are read-only)</td></tr>
</table>

<h2>Tests</h2>

<pre><code>cd backend
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/pip install -e ../../xwa-sdk/bindings/python   # optional but recommended
.venv/bin/pytest -q</code></pre>

<p>The suite covers health/contracts, analyses CRUD + cascade, raw and encrypted exports (<code>SAMURAI_DB_EXPORT_V1</code> roundtrip), parser helpers, the rate limiter, subprocess timeout helpers and the <code>Event</code> WebSocket shape (nmap is monkeypatched). The Angular 22 frontend ships its own Vitest suite (<code>npm test</code>): <code>ApiService</code> contracts, pure <code>Event</code> parsers, theme/i18n and the shared export toolbar.</p>

<hr>

<h2>Related Documents</h2>

<table>
  <tr><th>Document</th><th>Description</th></tr>
  <tr><td><a href="docs/manual.md">docs/manual.md</a></td><td>Development and production deployment guide</td></tr>
  <tr><td><a href="docs/ui-architecture.md">docs/ui-architecture.md</a></td><td>Frontend feature-driven architecture specification</td></tr>
  <tr><td><a href="docs/python-libraries.md">docs/python-libraries.md</a></td><td>Backend Python dependency inventory</td></tr>
  <tr><td><a href="docs/uses/dast.md">docs/uses/dast.md</a></td><td>DAST vulnerability scanning usage</td></tr>
  <tr><td><a href="samurai-tui/README.md">samurai-tui/README.md</a></td><td>Terminal application: installation, configuration, Docker, usage</td></tr>
  <tr><td><a href="ROADMAP.md">ROADMAP.md</a></td><td>Development phases and milestones</td></tr>
</table>

<hr>

<h2>Project Structure</h2>

<pre><code>samurai/
├── frontend/              # Angular 22 SPA (zoneless, core/shared/features)
│   └── src/environments/  # apiBaseUrl / wsBaseUrl (no hardcoded hosts)
├── backend/               # FastAPI Python (REST + WebSocket)
│   ├── app/
│   │   ├── main.py        # API routes, lifespan, CORS, rate limit
│   │   ├── database.py    # dual SQLite/PostgreSQL engine + PRAGMAs
│   │   ├── events.py      # xwa-sdk Event emitter (WS protocol)
│   │   ├── middleware.py  # in-process sliding-window rate limiter
│   │   ├── scanner.py     # Nmap port scanning engine
│   │   ├── crawler.py     # DAST vulnerability crawler (sqlmap/nuclei timeouts)
│   │   ├── db_exporter.py # Database export (raw + encrypted V1)
│   │   └── recon/         # Web reconnaissance modules
│   ├── tests/             # pytest suite (SQLite tmp DB)
│   └── requirements*.txt  # base / postgres / dev pins
├── samurai-tui/           # Rust terminal application (shares schema + export)
├── docs/                  # Technical documentation
├── samurai.sh             # Launcher: local (default) | docker
├── clean.sh               # Cleanup script (containers, caches, samurai.db)
└── docker-compose.yml     # frontend, backend (postgresql), postgres 17
</code></pre>

<div id="x" align="center">
<h2>X</h2>

<a href="https://dev.xscriptor.com">
  <img src="https://xscriptor.github.io/icons/icons/code/product-design/xsvg/verified-filled.svg" width="24" alt="X Web" />
</a>
 & 
<a href="https://github.com/xscriptor">
  <img src="https://xscriptor.github.io/icons/icons/code/product-design/xsvg/github.svg" width="24" alt="X Github Profile" />
</a>
 & 
<a href="https://www.xscriptor.com">
  <img src="https://xscriptor.github.io/icons/icons/code/product-design/xsvg/quotes.svg" width="24" alt="Xscriptor web" />
</a>

</div>
