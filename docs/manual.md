<h1>Samurai Application Manual</h1>

<p>This document details the necessary steps to run the application in a local development environment and provides the architectural configuration required for a production deployment.</p>

<p>Since the local-first rework, <strong>SQLite is the default database</strong>, Docker is optional and Redis/Celery are no longer part of the stack.</p>

<hr>

<h2>1. Local Development Execution</h2>

<p>The local environment is configured with Hot Module Replacement (HMR) for both the Angular frontend and the FastAPI backend. Changes made to the source files will be reflected immediately without the need to rebuild any container.</p>

<h3>1.1 Prerequisites</h3>
<ul>
    <li>Python 3.13. <code>uv</code> is recommended (<code>~/.local/bin/uv</code>) but a plain <code>python3 -m venv</code> also works.</li>
    <li>Node 24 (Angular 22 does not support every Node release; use mise or nvm to pin 24).</li>
    <li>Optional external scanners: <code>nmap</code>, <code>sqlmap</code>, <code>nuclei</code>. If a binary is missing the related module reports <code>DEPENDENCY_MISSING</code> and the rest of the scan continues.</li>
    <li>Docker is only required for <code>./samurai.sh docker</code> (PostgreSQL mode).</li>
</ul>

<h3>1.2 Startup Instructions (recommended)</h3>
<ol>
    <li>Open a terminal and navigate to the project root directory: <code>/samurai</code></li>
    <li>Run the launcher in local mode (default):</li>
</ol>

<pre><code>./samurai.sh          # or: ./samurai.sh local</code></pre>

<p>The script creates <code>backend/.venv</code> (Python 3.13 via uv), installs the local <code>xwa-sdk</code> binding when the sibling repo exists, installs <code>requirements.txt</code>, starts uvicorn on <code>:8000</code> and <code>ng serve</code> on <code>:4200</code>, then waits for <code>/api/health</code>.</p>

<h3>1.3 Manual Execution / IDE Setup</h3>
<p>If you prefer to run each process yourself:</p>
<ol>
    <li>Backend:
<pre><code>cd backend
~/.local/bin/uv venv --python 3.13 --seed .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e ../../xwa-sdk/bindings/python   # optional
DB_DRIVER=sqlite DB_PATH=../samurai.db .venv/bin/uvicorn app.main:app --port 8000</code></pre>
    </li>
    <li>Frontend:
<pre><code>cd frontend
export PATH="$HOME/.local/share/mise/installs/node/24/bin:$PATH"
npm ci        # reproducible install from package-lock.json
npm run start
npm test      # Vitest (ApiService, Event parsers, theme/i18n, export toolbar)
npm run build # production bundle in dist/samurai-web</code></pre>
    </li>
</ol>

<h3>1.4 Accessing the Services</h3>
<ul>
    <li><strong>Frontend (Angular UI):</strong> <code>http://localhost:4200</code></li>
    <li><strong>Backend API (FastAPI):</strong> <code>http://localhost:8000/docs</code> (Swagger UI)</li>
    <li><strong>Health:</strong> <code>http://localhost:8000/api/health</code></li>
    <li><strong>SQLite file:</strong> <code>&lt;repo&gt;/samurai.db</code> (override with <code>DB_PATH</code>)</li>
</ul>

<h3>1.5 Database Modes</h3>
<ul>
    <li><code>DB_DRIVER=sqlite</code> (default): file database with <code>PRAGMA foreign_keys=ON</code>, <code>journal_mode=WAL</code> and <code>busy_timeout=5000</code>.</li>
    <li><code>DB_DRIVER=postgresql</code>: set <code>DATABASE_URL</code> or <code>DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS</code>; install <code>requirements-postgres.txt</code>. The engine uses <code>pool_pre_ping=True</code> and <code>wait_for_db()</code> retries until the server answers.</li>
    <li>Schema and the <code>SAMURAI_DB_EXPORT_V1</code> encrypted format are shared with <code>samurai-tui</code> and must remain compatible.</li>
</ul>

<hr>

<h2>2. Production Configuration</h2>

<p>For a production environment, the development configuration must be modified to ensure security, performance, and stability.</p>

<h3>2.1 Frontend Optimization (Nginx)</h3>
<ul>
    <li>Create a <code>Dockerfile.prod</code> inside the frontend directory implementing a multi-stage build.</li>
    <li>Stage 1: build with <code>npx @angular/cli build --configuration production</code> (the build already reads <code>src/environments/environment.ts</code>).</li>
    <li>Stage 2: copy the built files from <code>/dist/samurai-web/browser</code> to <code>/usr/share/nginx/html</code>.</li>
    <li>Update the compose frontend service to use <code>Dockerfile.prod</code> and expose port <code>80</code>/<code>443</code> instead of <code>4200</code>, and remove the development volume.</li>
</ul>

<h3>2.2 Backend API Security and Performance</h3>
<ul>
    <li>Update the backend <code>Dockerfile</code> command to use Gunicorn with Uvicorn workers instead of the Uvicorn shell script. Example: <code>CMD ["gunicorn", "app.main:app", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000"]</code></li>
    <li>Remove the <code>--reload</code> flag and the development volumes from the backend service.</li>
    <li>Set <code>XWA_CORS_ORIGINS</code> to the real production origin(s). Credentials are disabled by design (<code>allow_credentials=False</code>).</li>
    <li>Tune the in-process rate limiter with <code>SAMURAI_RATE_LIMIT_MAX</code> / <code>SAMURAI_RATE_LIMIT_WINDOW</code> (default 120 req/min per IP, <code>/api/health</code> exempt). For multi-worker deployments, put a shared limiter at the reverse proxy if a global budget is required.</li>
</ul>

<h3>2.3 Database and Secrets Management</h3>
<ul>
    <li>Do not expose the PostgreSQL port to the public network. Remove the <code>ports:</code> binding for the <code>db</code> service in <code>docker-compose.yml</code> so it remains isolated on the internal Docker network.</li>
    <li>Migrate hardcoded credentials (<code>DB_USER</code>, <code>DB_PASS</code>) to Docker Secrets or an external secret manager (e.g. AWS Secrets Manager, HashiCorp Vault). Use an injected <code>.env</code> file in the interim; <code>DATABASE_URL</code> is the preferred single-variable override.</li>
    <li>Ensure the PostgreSQL (or SQLite) data volume is backed up with regular automated tasks. For SQLite, copy the file while WAL is checkpointed or use <code>VACUUM INTO</code>.</li>
    <li>No Redis/Celery services are required anymore; background scheduling is intentionally out of scope for this phase.</li>
</ul>

<hr>

<p><i>End of Manual.</i></p>
