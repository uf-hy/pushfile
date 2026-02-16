"""Serve album images and forced downloads.

Routes:
  GET /d/{token}/{filename}  — inline image (browser displays it)
  GET /f/{token}/{filename}  — forced download (Content-Disposition: attachment)

These replace the Caddy file_server rules so the app is self-contained.
"""

from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.storage import ALLOWED_SUFFIX, resolve_slug
from app.auth import safe_token, safe_name, token_dir, resolve_dir

router = APIRouter(tags=["files"])

# Map suffix to MIME type for explicit Content-Type
_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def _resolve_file(token: str, filename: str) -> Path:
    token = safe_token(token)
    filename = safe_name(filename)

    # Support slug albums: resolve slug -> real path -> directory
    real_path = resolve_slug(token)
    if real_path:
        d = resolve_dir(real_path).resolve()
    else:
        d = token_dir(token).resolve()

    f = (d / filename).resolve()

    # Safe directory containment check (not startswith)
    if not f.is_relative_to(d) or not f.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if f.suffix.lower() not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=404, detail="file not found")
    return f


@router.get("/d/{token}/{filename}")
def serve_image(token: str, filename: str):
    """Serve image inline (browser displays it)."""
    f = _resolve_file(token, filename)
    mime = _MIME.get(f.suffix.lower(), "application/octet-stream")
    return FileResponse(f, media_type=mime)


@router.get("/f/{token}/{filename}")
def download_image(token: str, filename: str):
    """Force download with Content-Disposition: attachment."""
    f = _resolve_file(token, filename)
    return FileResponse(
        f,
        filename=f.name,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{f.name}"'},
    )
