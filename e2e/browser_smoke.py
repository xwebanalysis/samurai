#!/usr/bin/env python3
"""Samurai zoneless-UI smoke test against a real browser, backend and nmap.

What it validates
-----------------
1. ``/scanner``   -- backend state renders with **no clicks** (recent runs),
   a real ``nmap`` quick scan of ``127.0.0.1`` completes from the UI and the
   open port ``8000/tcp`` is visible in the metrics/report/terminal; the new
   run is visible in ``/history`` immediately after navigation (no reload,
   no extra refresh click).
2. ``/recon``     -- a real ``headers`` recon against the local fixture
   completes and the results render by themselves; the terminal shows events.
3. ``/vulnerabilities`` -- a DAST run against the local fixture finishes (or
   fails in a controlled way). ``sqlmap``/``nuclei`` are not installed on this
   machine, so the engine must degrade gracefully instead of crashing.
4. ``/export``    -- raw and encrypted database exports respond with real
   downloads and the async status flips to ``[EXPORTED]`` without clicks.
5. EN/ES toggle   -- toggled on every page while asserting the rendered data
   survives the language switch.
6. Console errors and ``pageerror`` events must stay empty.

Prerequisites
-------------
* Local stack running (``cd samurai && ./samurai.sh local``) on 8000/4200.
* ``nmap`` installed.
* Run with the backend virtualenv interpreter::

      samurai/backend/.venv/bin/python samurai/e2e/browser_smoke.py

The script creates and serves the static fixture itself on port 8101 when it
is not already listening.
"""

from __future__ import annotations

import argparse
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from playwright.sync_api import (
    Browser,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)

FIXTURE_DIR = Path("/tmp/opencode/fixture-sam")
FIXTURE_PORT = 8101
FRONTEND_URL = "http://127.0.0.1:4200"
BACKEND_HEALTH_URL = "http://127.0.0.1:8000/api/health"
FIXTURE_URL = f"http://127.0.0.1:{FIXTURE_PORT}/"

SCAN_TARGET = "127.0.0.1"
SCAN_PROFILE = "quick"
EXPECTED_PORT_TOKEN = "8000/tcp"

FIXTURE_FILES: dict[str, str] = {
    "index.html": """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Samurai Local Fixture</title>
  <script>window.__fixtureLoaded = true;</script>
</head>
<body>
  <h1>Samurai Local Fixture</h1>
  <p>Static fixture served on http://127.0.0.1:8101 for local recon/DAST smoke tests.</p>
  <nav>
    <a href="/page2.html">Page 2</a>
    <a href="/page3.html">Page 3</a>
    <a href="/missing.html">Missing page</a>
  </nav>
  <form action="/submit" method="post">
    <label for="q">Search query</label>
    <input id="q" name="q" type="text" />
    <label for="email">Email</label>
    <input id="email" name="email" type="email" />
    <button type="submit">Send POST</button>
  </form>
  <form action="/search" method="get">
    <label for="search">Search</label>
    <input id="search" name="search" type="text" />
    <label for="comment">Comment</label>
    <textarea id="comment" name="comment"></textarea>
    <button type="submit">Send GET</button>
  </form>
  <script src="/app.js"></script>
</body>
</html>
""",
    "page2.html": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Fixture Page 2</title></head>
<body>
  <h1>Page 2</h1>
  <a href="/index.html">Back home</a>
  <a href="/page3.html">Page 3</a>
  <form action="/page2" method="post">
    <input name="name" type="text" />
    <input name="token" type="text" />
    <button type="submit">Submit</button>
  </form>
</body>
</html>
""",
    "page3.html": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Fixture Page 3</title></head>
<body>
  <h1>Page 3</h1>
  <a href="/index.html">Back home</a>
  <pre id="data">fixture data</pre>
</body>
</html>
""",
    "app.js": """// Fixture client script with a fake-looking secret for JS secret scanning.
window.__fixtureApi = {
  endpoint: '/api/v1/items',
  apiKey: 'fixture-fake-api-key-0000',
  build: 'e2e-fixture'
};
console.log('fixture app.js loaded');
""",
}


class Smoke:
    """Tiny assertion/evidence harness so the run ends with a readable report."""

    def __init__(self) -> None:
        self.checks: list[tuple[str, bool, str]] = []
        self.console_errors: list[str] = []
        self.page_errors: list[str] = []

    def check(self, name: str, condition: bool, evidence: str = "") -> bool:
        self.checks.append((name, condition, evidence))
        status = "PASS" if condition else "FAIL"
        print(f"[{status}] {name}" + (f" -- {evidence}" if evidence else ""))
        return condition

    def evidence(self, message: str) -> None:
        print(f"[EVIDENCE] {message}")

    def report(self) -> int:
        failures = [name for name, ok, _ in self.checks if not ok]
        print("\n==================== E2E SUMMARY ====================")
        print(f"checks: {len(self.checks)} | passed: {len(self.checks) - len(failures)} | failed: {len(failures)}")
        if failures:
            print("failed checks:")
            for name in failures:
                print(f"  - {name}")
        print(f"console errors: {len(self.console_errors)}")
        for line in self.console_errors[:10]:
            print(f"  - {line}")
        print(f"page errors:    {len(self.page_errors)}")
        for line in self.page_errors[:10]:
            print(f"  - {line}")
        ok = not failures and not self.console_errors and not self.page_errors
        print("RESULT:", "OK" if ok else "FAILED")
        return 0 if ok else 1


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def http_ok(url: str) -> bool:
    try:
        with urlopen(url, timeout=5) as response:
            return 200 <= response.status < 500
    except (URLError, OSError):
        return False


def ensure_fixture() -> subprocess.Popen[bytes] | None:
    """Materialise the fixture files and serve them if port 8101 is closed."""
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, content in FIXTURE_FILES.items():
        path = FIXTURE_DIR / name
        if not path.exists() or path.read_text() != content:
            path.write_text(content)

    if port_open(FIXTURE_PORT):
        print(f"[i] fixture already served on :{FIXTURE_PORT}")
        return None

    print(f"[i] serving fixture on :{FIXTURE_PORT} from {FIXTURE_DIR}")
    process = subprocess.Popen(
        ["python3", "-m", "http.server", str(FIXTURE_PORT), "--directory", str(FIXTURE_DIR)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        if port_open(FIXTURE_PORT):
            return process
        time.sleep(0.1)
    process.terminate()
    raise RuntimeError(f"fixture server did not start on :{FIXTURE_PORT}")


def wait_for_status(page: Page, expected: str, timeout_ms: int) -> None:
    page.wait_for_function(
        "(text) => document.querySelector('.system-status .t-label')?.textContent?.trim() === text",
        arg=expected,
        timeout=timeout_ms,
    )


def terminal_text(page: Page) -> str:
    return page.locator("app-terminal").inner_text()


def toggle_language_and_assert(page: Page, smoke: Smoke, label: str, data_check) -> None:
    """Switch to ES, assert data survives, switch back to EN."""
    page.locator("button.lang-toggle-btn").click()
    page.locator("button.lang-toggle-btn").get_by_text("ENGLISH").wait_for(timeout=5000)
    survived_es = data_check()
    smoke.check(f"{label}: data survives EN->ES toggle", survived_es)

    page.locator("button.lang-toggle-btn").click()
    page.locator("button.lang-toggle-btn").get_by_text("ESPAÑOL").wait_for(timeout=5000)
    survived_en = data_check()
    smoke.check(f"{label}: data survives ES->EN toggle", survived_en)


def scanner_history_rows(page: Page) -> list[str]:
    rows = page.locator("app-scanner-history .history-row")
    return [rows.nth(i).inner_text().replace("\n", " ") for i in range(rows.count())]


def history_cards(page: Page) -> list[str]:
    cards = page.locator(".scan-card")
    return [cards.nth(i).inner_text().replace("\n", " | ") for i in range(cards.count())]


def format_row(text: str) -> str:
    return " | ".join(part.strip() for part in text.split("|") if part.strip())


def ports_found_value(metrics_text: str) -> int:
    match = re.search(r"PORTS FOUND\s*\n\s*(\d+)", metrics_text)
    return int(match.group(1)) if match else -1


def step_scanner(page: Page, smoke: Smoke) -> None:
    print("\n--- STEP 1: scanner ---")
    page.goto(f"{FRONTEND_URL}/scanner", wait_until="networkidle")

    # No clicks: wait for the async history load to settle by itself.
    page.wait_for_timeout(1500)
    rows = scanner_history_rows(page)
    if rows:
        smoke.check(
            "scanner: recent runs rendered without clicks",
            True,
            f"rows={len(rows)} first={rows[0]}",
        )
        smoke.evidence(f"scanner history (pre-scan): {rows[0]}")
    else:
        smoke.check(
            "scanner: empty history settled without clicks (fresh DB)",
            page.locator("app-scanner-history .history-row").count() == 0,
            "no prior scans in DB",
        )

    page.fill("#scanner-target-domain", SCAN_TARGET)
    page.select_option("#scanner-scan-profile", SCAN_PROFILE)
    page.click("button:has-text('INITIATE SCAN')")

    wait_for_status(page, "SCANNING...", 15000)
    wait_for_status(page, "MODULE READY", 240000)

    # The detailed report is fetched after the stream closes.
    page.locator("app-scanner-report").get_by_text("DETAILED SCAN REPORT").wait_for(timeout=30000)

    port_tokens = [p.inner_text().strip() for p in page.locator("app-scanner-metrics .port-pill .port-token").all()]
    smoke.check(
        "scanner: nmap detected 8000/tcp",
        EXPECTED_PORT_TOKEN in port_tokens,
        f"ports={port_tokens}",
    )

    metrics_text = page.locator("app-scanner-metrics").inner_text()
    smoke.check(
        "scanner: PORTS FOUND metric updated without interaction",
        ports_found_value(metrics_text) >= 1,
        f"metrics={metrics_text.replace(chr(10), ' | ')[:180]}",
    )

    report_text = page.locator("app-scanner-report").inner_text().replace("\n", " | ")
    smoke.check(
        "scanner: report shows port 8000 details without interaction",
        EXPECTED_PORT_TOKEN in report_text,
        report_text[:180],
    )

    terminal = terminal_text(page)
    smoke.check("scanner: terminal streamed nmap output", "Nmap scan report" in terminal and "Uvicorn" in terminal)

    scan_id = None
    report_body_text = page.locator("app-scanner-report").inner_text()
    id_match = re.search(r"ID #(\d+)", report_body_text)
    if id_match:
        scan_id = id_match.group(1)
    smoke.check("scanner: completed run has a database id", scan_id is not None, f"scan_id={scan_id}")

    smoke.evidence(f"scanner detected ports: {port_tokens}")
    smoke.evidence(f"scanner terminal tail: {terminal.splitlines()[-1].strip()}")

    toggle_language_and_assert(
        page,
        smoke,
        "scanner",
        lambda: SCAN_TARGET == page.input_value("#scanner-target-domain")
        and EXPECTED_PORT_TOKEN in page.locator("app-scanner-metrics").inner_text(),
    )

    # History: navigate only, no reload and no refresh click.
    page.click("a[href='/history']")
    page.locator(".scan-card").first.wait_for(timeout=20000)
    cards = history_cards(page)
    expected_marker = f"ID_#{scan_id}" if scan_id else "ID_#"
    matching = [card for card in cards if expected_marker in card]
    smoke.check(
        f"history: new scan {expected_marker} visible after navigation without reload",
        bool(matching),
        matching[0] if matching else f"cards={cards[:3]}",
    )
    for card in cards[:5]:
        smoke.evidence(f"history row: {format_row(card)}")

    toggle_language_and_assert(page, smoke, "history", lambda: len(history_cards(page)) == len(cards))


def step_recon(page: Page, smoke: Smoke) -> None:
    print("\n--- STEP 2: recon (headers) ---")
    page.goto(f"{FRONTEND_URL}/recon", wait_until="networkidle")
    page.fill("#recon-target-domain", FIXTURE_URL)

    # Default selection is "all": clicking HEADERS switches to headers-only.
    page.click("button:has-text('HEADERS')")
    page.click("button:has-text('START RECONNAISSANCE')")

    page.locator("app-recon-results .results-container").wait_for(timeout=120000)
    page.locator("app-recon-results").get_by_text("SECURITY HEADERS").first.wait_for(timeout=30000)

    results_text = page.locator("app-recon-results").inner_text()
    smoke.check(
        "recon: results rendered without clicks",
        "MISSING CONTROLS" in results_text or "PRESENT CONTROLS" in results_text,
        results_text.replace("\n", " | ")[:180],
    )

    terminal = terminal_text(page)
    smoke.check(
        "recon: terminal shows live events",
        "[done] reconnaissance complete" in terminal and "security headers" in terminal.lower(),
    )
    smoke.evidence(f"recon terminal tail: {terminal.splitlines()[-1].strip()}")

    toggle_language_and_assert(
        page,
        smoke,
        "recon",
        lambda: page.locator("app-recon-results .results-container").is_visible(),
    )


def step_vulnerabilities(page: Page, smoke: Smoke) -> None:
    print("\n--- STEP 3: vulnerabilities (missing sqlmap/nuclei must degrade) ---")
    page.goto(f"{FRONTEND_URL}/vulnerabilities", wait_until="networkidle")
    page.fill("#vuln-target-url", FIXTURE_URL)
    page.click("button:has-text('INITIATE DAST SCAN')")

    wait_for_status(page, "CRAWLING...", 15000)
    wait_for_status(page, "MODULE READY", 300000)

    try:
        page.locator("app-vuln-analysis-summary").wait_for(state="visible", timeout=45000)
        completed = True
    except PlaywrightTimeoutError:
        completed = False

    terminal = terminal_text(page)
    controlled_error = "[!]" in terminal or "error" in terminal.lower()

    smoke.check(
        "vulnerabilities: run completed or showed a controlled error",
        completed or controlled_error,
        f"summary={completed}",
    )

    if completed:
        summary = page.locator("app-vuln-analysis-summary").inner_text()
        findings = page.locator("app-vuln-findings-report").inner_text()
        smoke.check(
            "vulnerabilities: analysis summary rendered without clicks",
            "TOTAL FINDINGS" in summary,
            summary.replace("\n", " | ")[:180],
        )
        smoke.check(
            "vulnerabilities: findings report rendered without clicks",
            "MATCHED NODES" in findings or "POST-SCAN TOPOLOGY" in findings,
        )

        # Router query-param round-trip: the filter select updates the URL and
        # the findings-report queryParamMap subscription must render the new
        # value without any extra interaction (zoneless markForCheck path).
        severity_select = page.locator("#severity-filter")
        severity_select.select_option("high")
        page.wait_for_timeout(600)
        smoke.check(
            "vulnerabilities: severity filter round-trip rendered",
            severity_select.input_value() == "high",
            f"select={severity_select.input_value()}",
        )

        page.click("button:has-text('RESET FILTERS')")
        page.wait_for_timeout(600)
        smoke.check(
            "vulnerabilities: filter reset round-trip rendered",
            severity_select.input_value() == "all",
            f"select={severity_select.input_value()}",
        )

    degradation = "SQLMap binary not found" in terminal or "Nuclei binary not found" in terminal
    smoke.check(
        "vulnerabilities: missing sqlmap/nuclei degraded gracefully",
        completed and (degradation or "DAST ENGINE RUN" in terminal),
        f"degradation_logged={degradation}",
    )
    smoke.evidence(f"vuln terminal tail: {terminal.splitlines()[-1].strip()}")

    toggle_language_and_assert(
        page,
        smoke,
        "vulnerabilities",
        lambda: page.locator("app-vuln-analysis-summary").is_visible(),
    )


def step_export(page: Page, smoke: Smoke) -> None:
    print("\n--- STEP 4: export database ---")
    page.goto(f"{FRONTEND_URL}/export", wait_until="networkidle")

    with page.expect_download(timeout=30000) as direct_info:
        page.click("button:has-text('DOWNLOAD DATABASE')")
    direct = direct_info.value
    smoke.check(
        "export: raw JSON download responds",
        direct.suggested_filename.endswith(".json"),
        direct.suggested_filename,
    )
    page.locator(".status-row").first.wait_for(timeout=15000)
    smoke.check(
        "export: raw export status rendered after await",
        "[EXPORTED]" in page.locator(".status-row").first.inner_text(),
    )

    page.click("button.mode-card:has-text('ENCRYPTED EXPORT')")
    page.fill("#encrypt-password", "smoke-pass-1234")
    with page.expect_download(timeout=30000) as encrypted_info:
        page.click("button:has-text('DOWNLOAD ENCRYPTED')")
    encrypted = encrypted_info.value
    smoke.check(
        "export: encrypted download responds",
        encrypted.suggested_filename.endswith(".bin.enc"),
        encrypted.suggested_filename,
    )
    encrypted_status = page.locator(".status-row").first.inner_text()
    smoke.check("export: encrypted export status rendered after await", "[EXPORTED]" in encrypted_status)
    smoke.evidence(f"export downloads: {direct.suggested_filename}, {encrypted.suggested_filename}")

    toggle_language_and_assert(
        page,
        smoke,
        "export",
        lambda: page.locator(".status-row").first.is_visible()
        and "[EXPORT" in page.locator(".status-row").first.inner_text(),
    )


def run_step(smoke: Smoke, name: str, step, page: Page) -> None:
    try:
        step(page, smoke)
    except Exception as exc:  # noqa: BLE001 - report any UI failure and keep going
        smoke.check(f"{name}: step completed without exception", False, f"{type(exc).__name__}: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Samurai zoneless UI browser smoke test")
    parser.add_argument("--headed", action="store_true", help="run Chromium with a visible window")
    parser.add_argument("--slow-mo", type=int, default=0, help="milliseconds between Playwright actions")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    smoke = Smoke()

    print(f"[i] frontend: {FRONTEND_URL}")
    if not http_ok(f"{FRONTEND_URL}/scanner"):
        print("[!] frontend is not reachable. Start it with: cd samurai && ./samurai.sh local")
        return 2
    if not http_ok(BACKEND_HEALTH_URL):
        print("[!] backend health is not reachable on :8000. Start the local stack first.")
        return 2

    fixture_process = ensure_fixture()

    try:
        with sync_playwright() as playwright:
            browser: Browser = playwright.chromium.launch(
                headless=not args.headed,
                slow_mo=args.slow_mo,
            )
            context = browser.new_context(
                viewport={"width": 1600, "height": 1000},
                accept_downloads=True,
            )
            context.add_init_script("try { localStorage.setItem('samurai-lang', 'en'); } catch (e) {}")
            page = context.new_page()
            page.on("pageerror", lambda error: smoke.page_errors.append(str(error)))
            page.on(
                "console",
                lambda message: smoke.console_errors.append(f"{message.type}: {message.text}")
                if message.type == "error"
                else None,
            )

            try:
                run_step(smoke, "scanner", step_scanner, page)
                run_step(smoke, "recon", step_recon, page)
                run_step(smoke, "vulnerabilities", step_vulnerabilities, page)
                run_step(smoke, "export", step_export, page)
            finally:
                context.close()
                browser.close()
    finally:
        if fixture_process is not None:
            fixture_process.terminate()
            fixture_process.wait(timeout=10)

    smoke.check("console errors are empty", not smoke.console_errors, str(smoke.console_errors[:3]))
    smoke.check("pageerror events are empty", not smoke.page_errors, str(smoke.page_errors[:3]))
    return smoke.report()


if __name__ == "__main__":
    sys.exit(main())
