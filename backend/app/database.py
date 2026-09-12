"""Database bootstrap with dual backend support.

Default driver is SQLite (100% local, no external services):

    DB_DRIVER=sqlite      (default)
    DB_PATH=<repo>/samurai.db

PostgreSQL is opt-in via:

    DB_DRIVER=postgresql
    DATABASE_URL=postgresql://user:pass@host:5432/db   (optional)
    # or DB_USER / DB_PASS / DB_HOST / DB_NAME

The table schema is intentionally frozen: ``samurai-tui`` (Rust) replicates it
and both interfaces share raw (``SAMURAI_DB_EXPORT_V1``) exports.
"""

import os
import time
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[2]

DB_DRIVER = os.getenv("DB_DRIVER", "sqlite").strip().lower()
DB_PATH = os.getenv("DB_PATH", str(REPO_ROOT / "samurai.db"))

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "samurai")

_DEFAULT_POSTGRES_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


def build_database_url() -> str:
    """Resolve the SQLAlchemy URL for the configured driver."""
    if DB_DRIVER == "sqlite":
        return f"sqlite:///{DB_PATH}"
    return os.getenv("DATABASE_URL", _DEFAULT_POSTGRES_URL)


DATABASE_URL = build_database_url()


def _create_engine():
    if DB_DRIVER == "sqlite":
        # ``check_same_thread=False`` is required because FastAPI serves the
        # session from worker threads; SQLite serializes writes on its own.
        sqlite_path = Path(DB_PATH)
        if sqlite_path.parent != Path("."):
            sqlite_path.parent.mkdir(parents=True, exist_ok=True)

        db_engine = create_engine(
            DATABASE_URL,
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(db_engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

        return db_engine

    return create_engine(DATABASE_URL, pool_pre_ping=True)


engine = _create_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def wait_for_db(max_retries: int = 30, retry_delay: float = 1.5):
    """Wait until the database answers. SQLite is local: nothing to wait for."""
    if DB_DRIVER == "sqlite":
        return

    last_error = None

    for _ in range(max_retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except Exception as exc:
            last_error = exc
            time.sleep(retry_delay)

    if last_error:
        raise last_error


def check_database() -> bool:
    """Return True when a trivial query succeeds against the configured engine."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# Dependency para inyectar sesión en FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
