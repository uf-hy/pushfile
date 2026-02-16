"""Serve album images and forced downloads.

Routes:
  GET /d/{token}/{filename}  — inline image (browser displays it)
  GET /f/{token}/{filename}  — forced download (Content-Disposition: attachment)

These replace the Caddy file_server rules so the app is self-contained.
"""

from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.auth import safe_token, safe_name, token_dir
from app.storage import ALLOWED_SUFFIX

router = APIRouter(tags=["files"])


def _resolve_file(token: str, filename: str) -> Path:
    token = safe_token(token)
    filename = safe_name(filename)
    d = token_dir(token)
    f = (d / filename).resolve()
    if not str(f).startswith(str(d)) or not f.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if f.suffix.lower() not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=403, detail="file type not allowed")
    return f


@router.get("/d/{token}/{filename}")
def serve_image(token: str, filename: str):
    """Serve image inline (browser displays it)."""
    return FileResponse(_resolve_file(token, filename))


@router.get("/f/{token}/{filename}")
def download_image(token: str, filename: str):
    """Force download with Content-Disposition: attachment."""
    f = _resolve_file(token, filename)
    return FileResponse(f, filename=f.name, media_type="application/octet-stream")
