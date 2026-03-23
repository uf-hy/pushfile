import os
import subprocess
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}

UPLOAD_SECRET = os.environ.get("UPLOAD_SECRET", "")
BASE_DIR = Path(os.environ.get("UPLOAD_BASE", "/var/www/photo.xaihub.de/downloads")).resolve()
MAX_MB = int(os.environ.get("UPLOAD_MAX_MB", "25"))
MAX_BYTES = MAX_MB * 1024 * 1024
SITE_DOMAIN = os.environ.get("SITE_DOMAIN", "photo.xaihub.de")
BASE_PATH = os.environ.get("BASE_PATH", "").rstrip("/")
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = Path(os.environ.get("FRONTEND_DIR", str(_PROJECT_ROOT / "frontend"))).resolve()
ANALYTICS_WRITE_LEGACY = _env_bool("ANALYTICS_WRITE_LEGACY", True)
ANALYTICS_WRITE_SQLITE = _env_bool("ANALYTICS_WRITE_SQLITE", True)
ANALYTICS_READ_SQLITE = _env_bool("ANALYTICS_READ_SQLITE", False)
REGION_TRACE_ENABLED = _env_bool("REGION_TRACE_ENABLED", True)
ANALYTICS_SQLITE_TIMEOUT_MS = int(os.environ.get("ANALYTICS_SQLITE_TIMEOUT_MS", "5000"))
ANALYTICS_SQLITE_SYNCHRONOUS = (os.environ.get("ANALYTICS_SQLITE_SYNCHRONOUS", "NORMAL") or "NORMAL").strip().upper()


def _resolve_app_version() -> str:
    env_version = (os.environ.get("APP_VERSION") or "").strip()
    if env_version:
        return env_version
    file_version = (_PROJECT_ROOT / ".version")
    if file_version.exists():
        from_file = file_version.read_text(encoding="utf-8").strip()
        if from_file:
            return from_file
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_PROJECT_ROOT),
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return commit or "dev"
    except Exception:
        return "dev"


APP_VERSION = _resolve_app_version()


def _resolve_asset_version() -> str:
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_PROJECT_ROOT),
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return commit or APP_VERSION or "dev"
    except Exception:
        return APP_VERSION or "dev"


ASSET_VERSION = _resolve_asset_version()


def _resolve_build_time() -> str:
    env_build = (os.environ.get("APP_BUILD_TIME") or "").strip()
    if env_build:
        return env_build
    file_build = (_PROJECT_ROOT / ".buildtime")
    if file_build.exists():
        from_file = file_build.read_text(encoding="utf-8").strip()
        if from_file:
            return from_file
    return "local"


APP_BUILD_TIME = _resolve_build_time()

if not UPLOAD_SECRET:
    raise RuntimeError("UPLOAD_SECRET is required")
