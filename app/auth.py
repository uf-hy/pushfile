import re
from fastapi import HTTPException
from pathlib import Path
from app.config import UPLOAD_SECRET, BASE_DIR

TOKEN_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
FOLDER_SEGMENT_RE = re.compile(r"^[^/\\.\x00]{1,120}$")
SAFE_NAME_RE = re.compile(r"^[^/\\\x00]{1,120}$")


def safe_token(token: str) -> str:
    token = token.strip()
    if not TOKEN_RE.match(token):
        raise HTTPException(status_code=400, detail="invalid token")
    return token


def safe_path(path: str) -> str:
    path = path.strip().strip("/")
    if not path:
        raise HTTPException(status_code=400, detail="empty path")
    for seg in path.split("/"):
        seg = seg.strip()
        if not seg or seg in (".", "..") or not FOLDER_SEGMENT_RE.match(seg):
            raise HTTPException(status_code=400, detail=f"invalid path segment: {seg}")
    return path


def resolve_dir(path: str) -> Path:
    d = (BASE_DIR / path).resolve()
    if not d.is_relative_to(BASE_DIR):
        raise HTTPException(status_code=400, detail="invalid path")
    return d


def safe_name(name: str) -> str:
    name = name.strip()
    if not SAFE_NAME_RE.match(name) or name in (".", "..") or name.startswith("."):
        raise HTTPException(status_code=400, detail="invalid filename")
    return name


def token_dir(token: str) -> Path:
    d = (BASE_DIR / token).resolve()
    if not d.is_relative_to(BASE_DIR):
        raise HTTPException(status_code=400, detail="invalid path")
    return d


def sniff_image_type(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if head.startswith(b"RIFF") and b"WEBP" in head[8:16]:
        return ".webp"
    return None


def auth_query_key(key: str):
    if key != UPLOAD_SECRET:
        raise HTTPException(status_code=401, detail="invalid key")


def auth_header_key(x_upload_key: str | None):
    if x_upload_key != UPLOAD_SECRET:
        raise HTTPException(status_code=401, detail="invalid key")
