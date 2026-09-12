<h1>Samurai: UI Architecture &amp; Folder Structure</h1>

<p>The Angular frontend is a <strong>feature-driven, zoneless Angular 22 application</strong> built with <code>@angular/build</code> (Vite/esbuild), standalone components and Vitest. Global concerns live in <code>core/</code>, reusable presentational pieces in <code>shared/</code>, and business domains in <code>features/</code>. All routes are lazy-loaded.</p>

<hr>

<h2>1. High-Level Directory Overview</h2>

<pre><code>frontend/
├── public/
│   ├── fonts/                 # Self-hosted woff2: Doto, Space Grotesk, Space Mono
│   ├── favicon.ico
│   └── icon.svg
├── scripts/test.sh            # `npm test` wrapper (ng test --watch=false)
├── src/
│   ├── app/
│   │   ├── core/              # Cross-cutting singletons
│   │   │   ├── api.service.ts       # Typed REST gateway (ALL HTTP calls)
│   │   │   ├── live.service.ts      # Unified WebSocket transport (3 streams)
│   │   │   ├── live-events.ts       # Pure xwa-sdk Event parsers + ReconResults types
│   │   │   ├── theme.service.ts     # Dark/light theme + localStorage
│   │   │   ├── i18n.service.ts      # EN/ES dictionaries + signal locale
│   │   │   └── translate.pipe.ts    # `| t` pipe (zoneless-aware)
│   │   ├── shared/            # Presentation-only components
│   │   │   ├── terminal/            # Live terminal panel (scanner/recon/DAST)
│   │   │   ├── metric-card/         # Instrument-panel metric card
│   │   │   ├── status-badge/        # Severity / status tag
│   │   │   ├── export-actions/      # CSV / JSON / PDF / BIN toolbar
│   │   │   └── findings-list/       # Finding rows (severity + PoC)
│   │   ├── features/          # Isolated business domains (lazy routes)
│   │   │   ├── scanner/       # Nmap port scanning + web surface
│   │   │   ├── vulnerabilities/# DAST crawling and findings report
│   │   │   ├── recon/         # DNS / subdomains / API / headers / tech
│   │   │   ├── history/       # Analysis archive table
│   │   │   └── export-database/# Raw + encrypted DB export UI
│   │   ├── app.config.ts      # provideZonelessChangeDetection + router + HTTP
│   │   ├── app.routes.ts      # Lazy-loaded routing rules
│   │   └── app.component.*    # Shell (sidebar, nav, theme, i18n)
│   ├── environments/          # environment.ts (+ .development.ts)
│   ├── _fonts.scss            # @font-face declarations for public/fonts
│   ├── index.html             # No runtime Google Fonts
│   └── styles.scss            # Nothing Design tokens (--gold included)
├── angular.json               # @angular/build:application + :unit-test
├── tsconfig.json / .app / .spec
└── package.json               # Angular 22 + TypeScript 6 + Vitest</code></pre>

<h2>2. Environment Configuration</h2>

<p>No component or service hardcodes <code>window.location.hostname:8000</code>. Backend and WebSocket bases come from:</p>

<pre><code>// src/environments/environment.ts (production build default)
export const environment = {
  production: true,
  apiBaseUrl: 'http://localhost:8000',
  wsBaseUrl: 'ws://localhost:8000'
};</code></pre>

<ul>
    <li><code>environment.development.ts</code> is wired through <code>fileReplacements</code> in the <code>development</code> build configuration.</li>
    <li><code>ApiService</code> is the only place that composes <code>${environment.apiBaseUrl}</code>/<code>${environment.wsBaseUrl}</code> URLs.</li>
    <li><code>ApiService.reconLiveUrls()</code> returns the direct backend URL plus a same-origin proxy fallback (<code>ws(s)://&lt;host&gt;/api/recon/live</code>) because Nginx can proxy <code>/api</code> in production.</li>
</ul>

<h2>3. REST Gateway (<code>core/api.service.ts</code>)</h2>

<p>Every HTTP call is centralized and typed. Feature components inject <code>ApiService</code>; none of them import <code>HttpClient</code> or <code>environment</code>.</p>

<table>
  <tr><th>Method</th><th>Endpoint</th></tr>
  <tr><td><code>health()</code></td><td><code>GET /api/health</code></td></tr>
  <tr><td><code>listScans()</code> / <code>getScan(id)</code> / <code>deleteScan(id)</code></td><td><code>/api/scans</code>, <code>/api/scans/{id}</code></td></tr>
  <tr><td><code>cancelScan(id)</code></td><td><code>POST /api/scan/cancel/{id}</code></td></tr>
  <tr><td><code>exportDatabaseRaw()</code> / <code>exportDatabaseEncrypted(password)</code></td><td><code>/api/database/export/raw|encrypted</code></td></tr>
  <tr><td><code>analysisExportUrl(id, format)</code></td><td><code>/api/analyses/{id}/export?format=json|csv</code></td></tr>
  <tr><td><code>scannerLiveUrl()</code> / <code>vulnLiveUrl()</code> / <code>reconLiveUrls()</code></td><td>WebSocket URL builders</td></tr>
</table>

<h2>4. WebSocket Consumption (xwa-sdk <code>Event</code>)</h2>

<p><code>core/live.service.ts</code> is the single WebSocket transport. It parses every frame with <code>parseEventEnvelope()</code>; non-JSON frames become a synthetic <code>log</code> event, so legacy plain-text backends keep rendering. <code>openWithFallback()</code> retries the proxy URL when the first socket never opens and supports an inactivity watchdog (recon: 45s).</p>

<p>The pure parsers live in <code>core/live-events.ts</code> and are unit-tested:</p>

<table>
  <tr><th>Helper</th><th>Backend payload</th></tr>
  <tr><td><code>openPortFromEvent()</code></td><td><code>item_found</code> with <code>kind=open_port</code> (<code>port</code>, <code>protocol</code>, <code>service</code>, <code>version</code>)</td></tr>
  <tr><td><code>contactProgressFromEvent()</code></td><td><code>analysis_progress.data</code> (<code>url</code>, <code>emails_count</code>, <code>phones_count</code>)</td></tr>
  <tr><td><code>unsanitizedFromEvent()</code></td><td><code>item_found</code> with <code>kind=unsanitized_input</code>/<code>reflected_input</code></td></tr>
  <tr><td><code>findingLineFromEvent()</code> / <code>terminalLineFromEvent()</code></td><td>DAST terminal formatting for all event types</td></tr>
  <tr><td><code>reconResultsFromEvent()</code></td><td><code>analysis_completed.payload.results</code> (typed <code>ReconResults</code>)</td></tr>
  <tr><td><code>openPortTokenFromLogLine()</code>, <code>openPortDetailFromLogLine()</code>, <code>scanIdFromLogLine()</code>, <code>openPortFromPayload()</code></td><td>Legacy log lines and persisted <code>OPEN_PORT</code> findings</td></tr>
</table>

<p>Frontend-side exports (JSON/CSV/PDF/BIN via jsPDF + pako) remain in each feature; the backend additionally exposes server-side <code>/api/analyses/{id}/export?format=json|csv</code>.</p>

<hr>

<h2>5. Feature Anatomy</h2>

<h3>5.1 <code>features/scanner/</code></h3>
<p>Target configuration, metric cards, history, shared terminal, detailed report and export toolbar. Uses <code>ApiService.scannerLiveUrl()</code> + <code>LiveService.open()</code>; contact/open-port/unsanitized counters come from the pure event parsers.</p>

<h3>5.2 <code>features/vulnerabilities/</code></h3>
<p>DAST crawling control, module toggles (TLS, headers, CORS, path brute, SQLi/XSS/LFI, SQLMap, Nuclei, Playwright, API security, auth scan, JS secrets), analysis summary (metric card + segmented bars + sparkline), findings accordion with shared <code>findings-list</code> and filters.</p>

<h3>5.3 <code>features/recon/</code></h3>
<p>DNS, subdomain, API, header and technology-stack modules. Uses <code>ApiService.reconLiveUrls()</code> and <code>LiveService.openWithFallback()</code> (direct backend → same-origin proxy, inactivity watchdog). History rehydration reads the serialized recon payload stored in findings.</p>

<h3>5.4 <code>features/history/</code> and <code>features/export-database/</code></h3>
<p>Archive browsing/deletion (<code>/api/scans</code> via <code>ApiService</code>) and the raw/encrypted export workflow (<code>SAMURAI_DB_EXPORT_V1</code>).</p>

<hr>

<h2>6. State, Change Detection &amp; Styling</h2>
<ul>
    <li><strong>Zoneless:</strong> <code>provideZonelessChangeDetection()</code> in <code>app.config.ts</code>; zone.js is not a dependency. Change detection is scheduled only by:
      <ul>
        <li>template event bindings (clicks, inputs, child <code>@Output()</code> emissions) — Angular marks the view dirty automatically;</li>
        <li>signal writes that are read from a template or service (e.g. <code>currentLang</code> in <code>core/i18n.service.ts</code>, <code>currentTheme</code> in <code>core/theme.service.ts</code>);</li>
        <li>explicit <code>ChangeDetectorRef.markForCheck()</code>.</li>
      </ul>
    </li>
    <li><strong>Zoneless rule (mandatory):</strong> after <strong>every</strong> mutation of plain component properties inside an async callback — <code>HttpClient</code>/<code>ApiService</code> subscriptions, <code>LiveService</code> WebSocket callbacks, <code>await</code> continuations, <code>setTimeout</code>/<code>setInterval</code> — the callback must finish with <code>this.cdr.markForCheck()</code>. The only exceptions are template-bound events and signal writes. Skipping it reproduces the systemic bug where <code>[ LOADING... ]</code> stays stuck, lists look empty even though the backend returned data, or values only appear after the user interacts with the page. This is applied in <code>scanner</code>, <code>recon</code>, <code>vulnerabilities</code>, <code>history</code>, <code>export-database</code>, <code>findings-report</code> (query-param subscription) and every error/early-return branch. Prefer <code>markForCheck()</code> over <code>detectChanges()</code>; the latter forces a synchronous tick and can throw if invoked while a change-detection pass is already running.</li>
    <li><strong>i18n:</strong> EN/ES dictionaries in <code>core/i18n.service.ts</code>, consumed through the impure <code>| t</code> pipe; locale persists in <code>localStorage</code> and updates <code>&lt;html lang&gt;</code>. The pipe reads the <code>currentLang</code> signal so language toggles schedule CD in zoneless mode.</li>
    <li><strong>Theme:</strong> <code>core/theme.service.ts</code> toggles <code>theme-dark</code>/<code>theme-light</code> on <code>&lt;body&gt;</code> with a short border/color transition; the toggle button reads the <code>currentTheme</code> signal.</li>
    <li><strong>Nothing Design:</strong> tokens in <code>styles.scss</code> (including <code>--gold: #FFD700</code>); labels are Space Mono ALL CAPS; no shadows, no gradients in UI chrome, no skeletons (bracket status text such as <code>[LOADING...]</code>), no emoji. Fonts are self-hosted from <code>public/fonts</code> via <code>_fonts.scss</code>.</li>
</ul>

<h2>7. Tests &amp; Build</h2>

<pre><code>export PATH="$HOME/.local/share/mise/installs/node/24/bin:$PATH"
npm ci                 # reproducible install from package-lock.json
npm test               # Vitest via @angular/build:unit-test
npm run build          # @angular/build:application (production)
npm audit --omit=dev   # 0 production vulnerabilities</code></pre>

<p>Specs cover <code>ApiService</code> (HTTP contracts + WS URL builders), the pure <code>Event</code> parsers (ports, recon results, findings, legacy lines), theme/i18n services and the shared export toolbar.</p>

<p><strong>Browser smoke test (real Chromium + real backend + real nmap):</strong> <code>e2e/browser_smoke.py</code> drives the local stack and asserts the zoneless behaviour end to end — backend state renders without clicks, a quick <code>nmap</code> scan detects <code>8000/tcp</code>, the run appears in History after plain navigation, recon headers render by themselves, DAST degrades gracefully without <code>sqlmap</code>/<code>nuclei</code>, raw/encrypted DB exports download, EN/ES toggles keep the rendered data and no console/page errors are produced. See <code>e2e/README.md</code>.</p>

<pre><code>samurai/backend/.venv/bin/python samurai/e2e/browser_smoke.py</code></pre>

<p>Unit tests must run on the Node 24 toolchain (the one <code>samurai.sh</code> selects). Node 26 exposes an experimental global <code>localStorage</code> that shadows the jsdom storage and makes the Vitest DOM environment fail.</p>

<hr>
<p><i>Feature-driven architecture for the Samurai cybersecurity platform (Angular 22 + Nothing Design).</i></p>
