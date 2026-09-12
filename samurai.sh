#!/usr/bin/env bash
# Samurai launcher.
#
#   ./samurai.sh                 # local (SQLite, no Docker)  ← default
#   ./samurai.sh local           # same as above
#   ./samurai.sh docker          # Docker Compose with PostgreSQL
#
# Legacy aliases kept for compatibility:
#   --native, --native-no-infra  → local mode
#   --docker                     → docker mode
set -e

# Prefer the mise-managed Node 24 LTS for Angular tooling (system Node may be unsupported)
if [ -d "$HOME/.local/share/mise/installs/node/24/bin" ]; then
    case ":$PATH:" in
        *":$HOME/.local/share/mise/installs/node/24/bin:"*) ;;
        *) export PATH="$HOME/.local/share/mise/installs/node/24/bin:$PATH" ;;
    esac
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

MODE="local"
BACKEND_PID=""
FRONTEND_PID=""
DOCKER_COMPOSE=""
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
XWA_SDK_PATH="${XWA_SDK_PATH:-$ROOT_DIR/../xwa-sdk/bindings/python}"
XWA_SDK_GIT="git+https://github.com/xwebanalysis/xwa-sdk.git#subdirectory=bindings/python"
BACKEND_PORT="${SAMURAI_BACKEND_PORT:-8000}"
FRONTEND_PORT="${SAMURAI_FRONTEND_PORT:-4200}"

# ── Node 24 detection (Angular requires it; mise is the supported toolchain) ──
ensure_node24() {
    local node_bin="$HOME/.local/share/mise/installs/node/24/bin"
    if [ ! -d "$node_bin" ]; then
        local latest
        latest="$(ls -d "$HOME/.local/share/mise/installs/node/"*/bin 2>/dev/null | sort -V | tail -1 || true)"
        [ -n "$latest" ] && node_bin="$latest"
    fi

    if [ -d "$node_bin" ]; then
        export PATH="$node_bin:$PATH"
    fi

    if ! command -v node &>/dev/null; then
        echo -e "${RED}[!] Node.js not found. Install Node 24 (mise: ${CYAN}mise use node@24${NC}).${NC}"
        exit 1
    fi

    local major
    major="$(node --version | sed 's/^v//' | cut -d. -f1)"
    if [ "$major" != "24" ]; then
        echo -e "${YELLOW}[!] Node $(node --version) detected; Angular 21 targets Node 24.${NC}"
        echo -e "${YELLOW}    mise users: export PATH=\"\$HOME/.local/share/mise/installs/node/24/bin:\$PATH\"${NC}"
    fi
}

# ── Docker compose variant detection ─────────────────────────────────
find_compose() {
    if docker compose version &>/dev/null; then
        DOCKER_COMPOSE="docker compose"; return 0
    fi
    if docker-compose --version &>/dev/null; then
        DOCKER_COMPOSE="docker-compose"; return 0
    fi
    return 1
}

docker_available() { command -v docker &>/dev/null && docker info &>/dev/null; }

# ── Cleanup trap ─────────────────────────────────────────────────────
cleanup() {
    echo -e "\n${RED}[!] Shutting down...${NC}"
    if [ "$MODE" = "docker" ]; then
        [ -n "$DOCKER_COMPOSE" ] && $DOCKER_COMPOSE -f "$COMPOSE_FILE" down 2>/dev/null || true
    else
        [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
        [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
        wait 2>/dev/null || true
    fi
    echo -e "${GREEN}[+] Done.${NC}"
    exit 0
}

usage() {
    echo "Usage: $0 [local|docker]"
    echo ""
    echo "  local (default)   SQLite, no Docker. Creates .venv with uv, installs"
    echo "                    dependencies, runs uvicorn :$BACKEND_PORT and ng serve :$FRONTEND_PORT."
    echo "  docker            Docker Compose stack with PostgreSQL (DB_DRIVER=postgresql)."
    echo ""
    echo "Legacy aliases: --native / --native-no-infra (= local), --docker (= docker)"
    echo ""
    echo "Environment:"
    echo "  DB_PATH, DB_DRIVER, DATABASE_URL, XWA_CORS_ORIGINS, SAMURAI_RATE_LIMIT_MAX"
    exit 1
}

case "${1:-local}" in
    local|--local|--native|--native-no-infra|--sqlite|--fast) MODE="local" ;;
    docker|--docker) MODE="docker" ;;
    -h|--help|help) usage ;;
    *) usage ;;
esac

trap cleanup SIGINT SIGTERM

# ══════════════════════════════════════════════════════════════════════
#  DOCKER MODE (PostgreSQL)
# ══════════════════════════════════════════════════════════════════════
if [ "$MODE" = "docker" ]; then
    if ! docker_available; then
        echo -e "${RED}[!] Docker is not available or not running.${NC}"
        exit 1
    fi
    if ! find_compose; then
        echo -e "${RED}[!] Docker Compose not found.${NC}"
        exit 1
    fi
    echo -e "${CYAN}[+] Starting Samurai with Docker Compose (DB_DRIVER=postgresql)...${NC}"
    $DOCKER_COMPOSE -f "$COMPOSE_FILE" up --build
    exit $?
fi

# ══════════════════════════════════════════════════════════════════════
#  LOCAL MODE (SQLite, no Docker)
# ══════════════════════════════════════════════════════════════════════
echo -e "${CYAN}[+] Starting Samurai locally (SQLite)...${NC}"
ensure_node24

if ! command -v nmap &>/dev/null; then
    echo -e "${YELLOW}[~] nmap not found: port scanning will report DEPENDENCY_MISSING.${NC}"
    echo -e "${YELLOW}    Install it with your package manager (e.g. sudo apt install nmap).${NC}"
fi

# ── Backend virtualenv ───────────────────────────────────────────────
echo -e "${CYAN}[+] Setting up Python environment...${NC}"
UV_BIN=""
if command -v uv &>/dev/null; then
    UV_BIN="uv"
elif [ -x "$HOME/.local/bin/uv" ]; then
    UV_BIN="$HOME/.local/bin/uv"
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
    if [ -n "$UV_BIN" ]; then
        $UV_BIN venv --python 3.13 --seed "$VENV_DIR"
    else
        echo -e "${YELLOW}[~] uv not found; falling back to python3 -m venv.${NC}"
        python3 -m venv "$VENV_DIR"
    fi
fi

PYTHON="$VENV_DIR/bin/python"
"$PYTHON" -m pip install --quiet --upgrade pip

if [ -d "$XWA_SDK_PATH" ]; then
    echo -e "${CYAN}[+] Installing local xwa-sdk ($XWA_SDK_PATH)...${NC}"
    "$PYTHON" -m pip install --quiet -e "$XWA_SDK_PATH"
else
    echo -e "${YELLOW}[~] Local xwa-sdk not found; events use the built-in fallback.${NC}"
    echo -e "${YELLOW}    To install the published binding: pip install \"$XWA_SDK_GIT\"${NC}"
fi

echo -e "${CYAN}[+] Installing Python dependencies...${NC}"
"$PYTHON" -m pip install --quiet -r "$BACKEND_DIR/requirements.txt"

# Optional PostgreSQL driver only when explicitly requested.
if [ "${DB_DRIVER:-sqlite}" = "postgresql" ] && [ -f "$BACKEND_DIR/requirements-postgres.txt" ]; then
    "$PYTHON" -m pip install --quiet -r "$BACKEND_DIR/requirements-postgres.txt"
fi

# ── Backend process ──────────────────────────────────────────────────
export DB_DRIVER="${DB_DRIVER:-sqlite}"
export DB_PATH="${DB_PATH:-$ROOT_DIR/samurai.db}"
echo -e "${CYAN}[+] Starting backend on :$BACKEND_PORT (DB_DRIVER=$DB_DRIVER, DB_PATH=$DB_PATH)...${NC}"
( cd "$BACKEND_DIR" && exec "$VENV_DIR/bin/uvicorn" app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload ) &
BACKEND_PID=$!

# ── Frontend process ─────────────────────────────────────────────────
echo -e "${CYAN}[+] Setting up frontend...${NC}"
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
fi
echo -e "${CYAN}[+] Starting frontend on :$FRONTEND_PORT...${NC}"
npm start &
FRONTEND_PID=$!
cd "$ROOT_DIR"

# ── Wait for health ──────────────────────────────────────────────────
echo -n -e "${CYAN}[~] Waiting for backend health...${NC}"
HEALTH_OK=false
for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    echo -n "."
    sleep 1
done
if [ "$HEALTH_OK" = true ]; then
    echo -e " ${GREEN}ready${NC}"
else
    echo -e " ${RED}timeout${NC}"
    echo -e "${RED}[!] Backend did not become healthy. Check the uvicorn output above.${NC}"
fi

echo ""
echo -e "${GREEN}[+] Samurai is running:${NC}"
echo -e "    Frontend:  ${CYAN}http://localhost:$FRONTEND_PORT${NC}"
echo -e "    Backend:   ${CYAN}http://localhost:$BACKEND_PORT${NC}"
echo -e "    Health:    ${CYAN}http://localhost:$BACKEND_PORT/api/health${NC}"
echo -e "    Database:  ${CYAN}$DB_PATH (SQLite)${NC}"
echo -e "    Press ${RED}Ctrl+C${NC} to stop both."
echo ""

wait
