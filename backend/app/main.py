import csv
import io
import json
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session, joinedload
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import crawler, database, db_exporter, events, models, scanner
from .middleware import RateLimitMiddleware
from .recon import perform_web_recon

APP_VERSION = "2.5.0"
TOOL_NAME = "samurai"

# Default CORS policy: local development hosts plus RFC1918 LAN ranges.
_DEFAULT_CORS_REGEX = (
    r"^https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$"
    r"|^https?://(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}"
    r"|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$"
)

_HTTP_ERROR_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL",
    502: "UPSTREAM_ERROR",
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database.wait_for_db()
    models.Base.metadata.create_all(bind=database.engine)
    yield


app = FastAPI(
    title="Samurai API",
    description="Deep Cybersecurity Analysis API",
    version=APP_VERSION,
    lifespan=lifespan,
)


def _looks_like_regex(entry: str) -> bool:
    return any(char in entry for char in "\\^$?*+[]()|")


def _cors_settings() -> tuple[list[str], str | None]:
    """Resolve ``XWA_CORS_ORIGINS`` into (origins, regex).

    Comma-separated entries are treated as literal origins unless they contain
    regex metacharacters, in which case they are joined into ``allow_origin_regex``.
    """
    raw = os.getenv("XWA_CORS_ORIGINS", "").strip()
    if not raw:
        return [], _DEFAULT_CORS_REGEX

    origins: list[str] = []
    regexes: list[str] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if _looks_like_regex(entry):
            regexes.append(entry)
        else:
            origins.append(entry.rstrip("/"))

    return origins, "|".join(f"(?:{entry})" for entry in regexes) if regexes else None


_cors_origins, _cors_regex = _cors_settings()

# Rate limiting first, CORS last so preflight/error responses keep CORS headers.
app.add_middleware(
    RateLimitMiddleware,
    exempt_paths=("/api/health",),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        content = detail
    else:
        content = {
            "error": {
                "code": _HTTP_ERROR_CODES.get(exc.status_code, "HTTP_ERROR"),
                "message": str(detail),
                "detail": {},
                "retryable": exc.status_code >= 500,
            }
        }
    return JSONResponse(status_code=exc.status_code, content=content, headers=getattr(exc, "headers", None))


@app.get("/")
def read_root():
    return {
        "status": "ok",
        "service": TOOL_NAME,
        "tool": TOOL_NAME,
        "version": APP_VERSION,
        "message": "Samurai Engine Running with WebSockets enabled",
    }


@app.get("/api/health")
def health():
    db_ok = database.check_database()
    return {
        "status": "ok",
        "database": "ok" if db_ok else "error",
        "version": APP_VERSION,
        "tool": TOOL_NAME,
    }


@app.websocket("/api/scan/live")
async def websocket_scan(
    websocket: WebSocket,
    target: str,
    profile: str = "quick",
    timeout: int = 180,
    web_scan: bool = False,
    collect_contacts: bool = False,
    scan_unsanitized: bool = False,
    max_pages: int = 10,
    db: Session = Depends(database.get_db)
):
    await websocket.accept()
    emitter = events.EventEmitter(websocket, tool=TOOL_NAME)
    try:
        await scanner.perform_nmap_scan(
            target,
            emitter,
            db,
            profile=profile,
            timeout_seconds=timeout,
            web_scan=web_scan,
            collect_contacts=collect_contacts,
            scan_unsanitized=scan_unsanitized,
            max_pages=max_pages,
        )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        if emitter.is_bound:
            try:
                await emitter.error("INTERNAL", str(e), retryable=True)
            except Exception:
                pass
        await emitter.close()


@app.websocket("/api/vuln/live")
async def websocket_vuln_crawler(
    websocket: WebSocket,
    target: str,
    modules: str = "all",
    auth_mode: str = "bearer_first",
    auth_bearer: str = "",
    auth_user: str = "",
    auth_pass: str = "",
    auth_cookie: str = "",
    db: Session = Depends(database.get_db)
):
    await websocket.accept()
    emitter = events.EventEmitter(websocket, tool=TOOL_NAME)
    try:
        auth_context = {
            "mode": auth_mode,
            "bearer": auth_bearer,
            "user": auth_user,
            "password": auth_pass,
            "cookie": auth_cookie,
        }
        await crawler.perform_crawl(target, modules, emitter, db, auth_context)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        if emitter.is_bound:
            try:
                await emitter.error("INTERNAL", str(e), retryable=True)
            except Exception:
                pass
        await emitter.close()


@app.websocket("/api/recon/live")
async def websocket_recon(
    websocket: WebSocket,
    target: str,
    recon_types: str = "all",
    timeout: int = 300,
    db: Session = Depends(database.get_db)
):
    await websocket.accept()
    emitter = events.EventEmitter(websocket, tool=TOOL_NAME)
    scan_record = None

    try:
        # Create scan record in database
        scan_record = models.Scan(
            domain_target=target,
            status="RUNNING",
            scan_type="web_recon"
        )
        db.add(scan_record)
        db.commit()
        db.refresh(scan_record)

        emitter.bind(scan_record.id)
        recon_list = recon_types.split(",") if recon_types != "all" else ["all"]

        await emitter.emit(
            "analysis_started",
            {
                "id": scan_record.id,
                "target": target,
                "scan_type": "web_recon",
                "modules": recon_list,
                "timeout": timeout,
            },
        )
        await emitter.log("[init] recon session established")

        results = await perform_web_recon(
            target,
            recon_list,
            emitter,
            timeout_seconds=timeout
        )

        # Save results as findings
        if results:
            results_json = json.dumps(results, indent=2)
            finding = models.Finding(
                scan_id=scan_record.id,
                severity="info",
                finding_type="web_recon_results",
                description=f"Web reconnaissance results for {target}",
                poc_payload=results_json,
            )
            db.add(finding)

        # Mark as completed
        scan_record.status = "COMPLETED"
        db.commit()
        await emitter.log("[done] scan completed and saved to history")
        await emitter.completed(
            {
                "total_items": len(results or {}),
                "by_severity": {},
                "sections": sorted((results or {}).keys()),
            },
            status="COMPLETED",
            scan_id=scan_record.id,
            target=target,
            results=results or {},
        )

    except WebSocketDisconnect:
        if scan_record:
            scan_record.status = "CANCELLED"
            db.commit()
    except Exception as e:
        if scan_record:
            scan_record.status = "ERROR"
            db.commit()
        if emitter.is_bound:
            try:
                await emitter.error("INTERNAL", str(e), retryable=True)
            except Exception:
                pass


# --- CRUD PARA HISTORIAL DE ANALISIS ---

@app.get("/api/scans")
def list_scans(db: Session = Depends(database.get_db)):
    scans = db.query(models.Scan).order_by(models.Scan.id.desc()).all()
    return scans


def _load_scan_detail(db: Session, scan_id: int):
    return db.query(models.Scan)\
             .options(joinedload(models.Scan.findings),
                      joinedload(models.Scan.discovered_links).joinedload(models.DiscoveredLink.findings))\
             .filter(models.Scan.id == scan_id)\
             .first()


@app.get("/api/scans/{scan_id}")
def get_scan_details(scan_id: int, db: Session = Depends(database.get_db)):
    scan = _load_scan_detail(db, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


@app.delete("/api/scans/{scan_id}")
def delete_scan(scan_id: int, db: Session = Depends(database.get_db)):
    scan = db.query(models.Scan).filter(models.Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    db.delete(scan)
    db.commit()
    return {"status": "deleted", "scan_id": scan_id}


@app.post("/api/scan/cancel/{scan_id}")
def cancel_scan(scan_id: int, db: Session = Depends(database.get_db)):
    cancelled = scanner.request_cancel_scan(scan_id, db)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Running scan not found")
    return {"status": "cancellation-requested", "scan_id": scan_id}


# --- UNIFIED XWA-SDK ANALYSIS ENDPOINTS (aliases of /api/scans) ---

def _scan_to_analysis(scan: models.Scan, detail: bool = False) -> dict:
    data = {
        "id": str(scan.id),
        "tool": TOOL_NAME,
        "tool_version": APP_VERSION,
        "target": scan.domain_target,
        "status": scan.status,
        "analysis_type": scan.scan_type,
        "created_at": scan.created_at.isoformat() if scan.created_at else None,
    }
    if detail:
        data["findings"] = [_finding_to_dict(finding) for finding in scan.findings]
        data["discovered_links"] = [
            {
                "id": link.id,
                "url": link.url,
                "status_code": link.status_code,
                "content_type": link.content_type,
                "findings": [_finding_to_dict(finding) for finding in link.findings],
            }
            for link in scan.discovered_links
        ]
    return data


def _finding_to_dict(finding: models.Finding) -> dict:
    return {
        "id": finding.id,
        "scan_id": finding.scan_id,
        "link_id": finding.link_id,
        "severity": finding.severity,
        "finding_type": finding.finding_type,
        "title": finding.finding_type,
        "description": finding.description,
        "poc_payload": finding.poc_payload,
        "cvss_score": finding.cvss_score,
    }


def _analysis_csv_rows(detail: dict) -> list[list[str]]:
    headers = [
        "analysis_id",
        "target",
        "link_id",
        "url",
        "status_code",
        "finding_type",
        "severity",
        "cvss_score",
        "description",
        "poc_payload",
    ]
    rows = [headers]
    for finding in detail.get("findings", []):
        rows.append([
            detail["id"],
            detail["target"] or "",
            "",
            "",
            "",
            finding.get("finding_type") or "",
            finding.get("severity") or "",
            finding.get("cvss_score") or "",
            finding.get("description") or "",
            finding.get("poc_payload") or "",
        ])
    for link in detail.get("discovered_links", []):
        for finding in link.get("findings", []):
            rows.append([
                detail["id"],
                detail["target"] or "",
                str(link.get("id") or ""),
                link.get("url") or "",
                str(link.get("status_code") or ""),
                finding.get("finding_type") or "",
                finding.get("severity") or "",
                finding.get("cvss_score") or "",
                finding.get("description") or "",
                finding.get("poc_payload") or "",
            ])
    return rows


@app.get("/api/analyses")
def list_analyses(db: Session = Depends(database.get_db)):
    scans = db.query(models.Scan).order_by(models.Scan.id.desc()).all()
    return [_scan_to_analysis(scan) for scan in scans]


@app.get("/api/analyses/{analysis_id}")
def get_analysis(analysis_id: int, db: Session = Depends(database.get_db)):
    scan = _load_scan_detail(db, analysis_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return _scan_to_analysis(scan, detail=True)


@app.delete("/api/analyses/{analysis_id}")
def delete_analysis(analysis_id: int, db: Session = Depends(database.get_db)):
    scan = db.query(models.Scan).filter(models.Scan.id == analysis_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Analysis not found")
    db.delete(scan)
    db.commit()
    return {"status": "deleted", "analysis_id": str(analysis_id)}


@app.get("/api/analyses/{analysis_id}/export")
def export_analysis(analysis_id: int, format: str = "json", db: Session = Depends(database.get_db)):
    export_format = (format or "json").strip().lower()
    if export_format not in {"json", "csv"}:
        raise HTTPException(status_code=400, detail="format must be 'json' or 'csv'")

    scan = _load_scan_detail(db, analysis_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Analysis not found")

    detail = _scan_to_analysis(scan, detail=True)

    if export_format == "json":
        body = json.dumps(detail, indent=2, ensure_ascii=False).encode("utf-8")
        media_type = "application/json"
        filename = f"samurai-analysis-{analysis_id}.json"
    else:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerows(_analysis_csv_rows(detail))
        body = buffer.getvalue().encode("utf-8")
        media_type = "text/csv; charset=utf-8"
        filename = f"samurai-analysis-{analysis_id}.csv"

    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- DATABASE EXPORTS (raw + encrypted, TUI-compatible) ---

@app.get("/api/database/export/raw")
def export_database_raw(db: Session = Depends(database.get_db)):
    payload = db_exporter.build_export_payload(db)
    json_bytes = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={
            "Content-Disposition": "attachment; filename=samurai-database-export.json"
        },
    )


@app.post("/api/database/export/encrypted")
async def export_database_encrypted(payload: dict, db: Session = Depends(database.get_db)):
    password = payload.get("password", "")

    if not password or len(password) < 4:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 4 characters",
        )

    export_data = db_exporter.build_export_payload(db)
    encrypted = db_exporter.encrypt_export_payload(export_data, password)
    return Response(
        content=encrypted,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename=samurai-database-export.bin.enc"
        },
    )
