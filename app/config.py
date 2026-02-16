import os
from pathlib import Path

UPLOAD_SECRET = os.environ.get("UPLOAD_SECRET", "")
BASE_DIR = Path(os.environ.get("UPLOAD_BASE", "/var/www/photo.xaihub.de/downloads")).resolve()
MAX_MB = int(os.environ.get("UPLOAD_MAX_MB", "25"))
MAX_BYTES = MAX_MB * 1024 * 1024
SITE_DOMAIN = os.environ.get("SITE_DOMAIN", "photo.xaihub.de")
BASE_PATH = os.environ.get("BASE_PATH", "").rstrip("/")
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = Path(os.environ.get("FRONTEND_DIR", str(_PROJECT_ROOT / "frontend"))).resolve()

if not UPLOAD_SECRET:
    raise RuntimeError("UPLOAD_SECRET is required")


def static_prefix(base_path: str | None = None) -> str:
    """
    Prefix for backend-served static assets (e.g. "/b" in production).
    Ensures templates never emit relative asset URLs like "static/..." that
    would resolve under "/d/<token>" and hit the wrong site.
    """
    p = (BASE_PATH if base_path is None else base_path).strip()
    if not p or p == ".":
        return ""
    if not p.startswith("/"):
        p = "/" + p
    return p.rstrip("/")
