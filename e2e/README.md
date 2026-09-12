# Samurai browser smoke test (zoneless UI)

`browser_smoke.py` is the end-to-end regression test for the zoneless Angular
frontend. It drives a real Chromium instance against the local stack
(backend `:8000`, frontend `:4200`), a real `nmap` scan and a local static
fixture (`:8101`), and fails on any render regression, console error or
`pageerror`.

## What it checks

| Step | Page | Assertion |
| --- | --- | --- |
| 1 | `/scanner` | Recent runs render with **no clicks**; a real `nmap` quick scan of `127.0.0.1` completes and `8000/tcp` appears in metrics, report and terminal without interaction. |
| 1b | `/history` | The new run (`ID_#<n>`) is listed right after navigation, with **no manual reload and no extra refresh click**. |
| 2 | `/recon` | A `headers` recon of `http://127.0.0.1:8101/` renders its results by itself; the terminal streams events. |
| 3 | `/vulnerabilities` | A DAST run against the fixture completes (or fails in a controlled way). Missing `sqlmap`/`nuclei` must degrade, not crash. |
| 4 | `/export` | Raw JSON and AES-256-GCM encrypted downloads respond and the async status flips to `[EXPORTED]`. |
| 5 | all pages | EN/ES toggle keeps the rendered data (target, ports, results, rows, export status, summary). |
| 6 | all pages | Browser console `error` messages and `pageerror` events stay empty. |

## Prerequisites

* Node 24 toolchain (the same one `samurai.sh` selects) for the frontend build.
* `nmap` installed and on `PATH`.
* Playwright Chromium installed in the backend virtualenv.
* The local stack running:

```sh
cd samurai
./samurai.sh local          # backend :8000, frontend :4200
```

## Run

From the repository root:

```sh
samurai/backend/.venv/bin/python samurai/e2e/browser_smoke.py
```

Optional flags:

```sh
--headed        # show the Chromium window
--slow-mo 200   # slow every Playwright action by 200 ms
```

The script creates the fixture under `/tmp/opencode/fixture-sam/` and starts
its own `python3 -m http.server 8101` when the port is not already serving,
then stops it on exit. If the backend/frontend are not reachable it exits
with code `2` and prints the start command. A failed check or a captured
browser error makes it exit with code `1` after printing the evidence summary.

## Reading the output

Every check prints `[PASS]`/`[FAIL]`; runtime facts are printed as
`[EVIDENCE]`, including the scanner history row, the detected port tokens and
the history rows. The final `==================== E2E SUMMARY ====================`
block lists failures plus console/page errors.

Example evidence:

```
[EVIDENCE] scanner history (pre-scan): #2 127.0.0.1 ports: 1 contacts: 0 unsanitized: 0 COMPLETED
[EVIDENCE] scanner detected ports: ['8000/tcp']
[EVIDENCE] history row: ID_#5 | DELETE | 127.0.0.1 | [COMPLETED] | TYPE: PORT_SCAN:QUICK+WEB
```
