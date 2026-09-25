"""Optional JWT authentication + RBAC for the Samurai API.

Auth is disabled by default: when ``SAMURAI_JWT_SECRET`` is unset, every route
behaves exactly as it always did. Setting the secret enables Bearer-token auth:

    SAMURAI_JWT_SECRET=<long random string>
    SAMURAI_ADMIN_PASSWORD=changeme   # password for POST /api/auth/login

Roles (claim ``role`` in the token):
- ``admin``   — full access (login, destructive routes, database exports).
- ``analyst`` — read-only: list/get/export single analyses allowed; delete,
  cancel, scan initiation and database exports are rejected with 403.

WebSocket endpoints accept the token via the ``token`` query parameter.
"""

from __future__ import annotations

import datetime as dt
import hmac
import os
from typing import Any

import jwt
from fastapi import HTTPException, Request, WebSocket

_ALGORITHM = "HS256"
_TOKEN_TTL_SECONDS = 12 * 60 * 60

EXEMPT_PATHS = ("/", "/api/health", "/api/auth/login")


def auth_enabled() -> bool:
    return bool(os.getenv("SAMURAI_JWT_SECRET", "").strip())


def admin_password() -> str:
    return os.getenv("SAMURAI_ADMIN_PASSWORD", "changeme")


def create_access_token(subject: str = "admin", role: str = "admin") -> str:
    """Issue an HS256 token with ``sub`` and ``role`` claims."""
    secret = os.environ["SAMURAI_JWT_SECRET"]
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=_TOKEN_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict[str, Any] | None:
    """Return claims when the token is valid, else ``None``."""
    secret = os.environ.get("SAMURAI_JWT_SECRET", "")
    try:
        claims = jwt.decode(token, secret, algorithms=[_ALGORITHM])
    except (jwt.PyJWTError, ValueError):
        return None
    return claims if isinstance(claims, dict) else None


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.query_params.get("token")


def _extract_token_ws(websocket: WebSocket) -> str | None:
    return websocket.query_params.get("token")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={
            "error": {
                "code": "UNAUTHORIZED",
                "message": detail,
                "detail": {},
                "retryable": False,
            }
        },
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "error": {
                "code": "FORBIDDEN",
                "message": detail,
                "detail": {},
                "retryable": False,
            }
        },
    )


def require_user(request: Request) -> dict[str, Any]:
    """FastAPI dependency: any valid token passes; returns the claims."""
    if not auth_enabled():
        return {}
    token = _extract_token(request)
    if not token:
        raise _unauthorized("Missing bearer token")
    claims = decode_token(token)
    if claims is None:
        raise _unauthorized("Invalid or expired token")
    return claims


def require_admin(request: Request) -> dict[str, Any]:
    """FastAPI dependency: only tokens with role=admin pass."""
    claims = require_user(request)
    if not claims:
        return claims
    if claims.get("role") != "admin":
        raise _forbidden("Admin role required")
    return claims


async def websocket_require_user(websocket: WebSocket) -> bool:
    """Validate WebSocket token; caller must close on ``False``."""
    if not auth_enabled():
        return True
    token = _extract_token_ws(websocket)
    if not token or decode_token(token) is None:
        return False
    return True


def verify_admin_password(candidate: str) -> bool:
    return hmac.compare_digest(candidate, admin_password())
