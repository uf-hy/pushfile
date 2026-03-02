from email.utils import parsedate
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse

from app.auth import safe_name, safe_token, token_dir, resolve_dir
from app.image_variants import ensure_download_jpeg, ensure_thumb_avif
from app.storage import ALLOWED_SUFFIX, resolve_slug

router = APIRouter(tags=["files"])

_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

_NOT_MODIFIED_HEADERS = {
    "cache-control",
    "content-location",
    "date",
    "etag",
    "expires",
    "vary",
}


def _resolve_file(token: str, filename: str) -> Path:
    token = safe_token(token)
    filename = safe_name(filename)
    real_path = resolve_slug(token)
    if real_path:
        d = resolve_dir(real_path).resolve()
    else:
        d = token_dir(token).resolve()
    f = (d / filename).resolve()
    if not f.is_relative_to(d) or not f.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if f.suffix.lower() not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=404, detail="file not found")
    return f


def _is_not_modified(response_headers, request_headers) -> bool:
    if_none_match = request_headers.get("if-none-match")
    if if_none_match:
        etag = response_headers.get("etag")
        if etag and etag in [tag.strip(" W/") for tag in if_none_match.split(",")]:
            return True
    try:
        if_modified_since = parsedate(request_headers["if-modified-since"])
        last_modified = parsedate(response_headers["last-modified"])
        if if_modified_since is not None and last_modified is not None and if_modified_since >= last_modified:
            return True
    except KeyError:
        return False
    return False


def _not_modified_headers(headers) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() in _NOT_MODIFIED_HEADERS}


def _with_304(request: Request, response: FileResponse):
    if _is_not_modified(response.headers, request.headers):
        return Response(status_code=304, headers=_not_modified_headers(response.headers))
    return response


def _file_response(path: Path, **kwargs) -> FileResponse:
    try:
        st = path.stat()
    except OSError:
        st = None
    if st is not None:
        return FileResponse(path, stat_result=st, **kwargs)
    return FileResponse(path, **kwargs)


@router.get("/d/{token}/{filename}")
def serve_image(request: Request, token: str, filename: str):
    f = _resolve_file(token, filename)
    mime = _MIME.get(f.suffix.lower(), "application/octet-stream")
    resp = _file_response(f, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})
    return _with_304(request, resp)


@router.get("/v/{token}/{filename}")
def serve_variant(
    request: Request,
    token: str,
    filename: str,
    kind: str = Query(default="thumb-avif", pattern="^(thumb-avif|view-jpg)$"),
    src: str | None = Query(default=None),
):
    source_name = src if src else filename
    source_path = _resolve_file(token, source_name)
    if kind == "thumb-avif":
        try:
            avif = ensure_thumb_avif(source_path)
            resp = _file_response(avif, media_type="image/avif", headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return _with_304(request, resp)
        except Exception:
            pass
    try:
        jpg = ensure_download_jpeg(source_path)
        resp = _file_response(jpg, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
        return _with_304(request, resp)
    except Exception:
        mime = _MIME.get(source_path.suffix.lower(), "application/octet-stream")
        resp = _file_response(source_path, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})
        return _with_304(request, resp)


@router.get("/f/{token}/{filename}")
def download_image(request: Request, token: str, filename: str):
    source_path = _resolve_file(token, filename)
    try:
        jpg = ensure_download_jpeg(source_path)
        out_name = f"{Path(source_path.name).stem}.jpg"
        resp = _file_response(
            jpg,
            media_type="image/jpeg",
            filename=out_name,
            content_disposition_type="attachment",
            headers={"Cache-Control": "public, max-age=86400"},
        )
        return _with_304(request, resp)
    except Exception:
        resp = _file_response(
            source_path,
            filename=source_path.name,
            content_disposition_type="attachment",
            headers={"Cache-Control": "public, max-age=86400"},
        )
        return _with_304(request, resp)
