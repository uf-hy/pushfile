import json
import os
import ipaddress
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from app.auth import safe_token
from app.storage import list_images, get_token_title, record_visit, resolve_slug, list_images_by_path
from app.config import FRONTEND_DIR, SITE_DOMAIN, MAX_MB, BASE_PATH
from app.security import SlidingWindowRateLimiter

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory=str(FRONTEND_DIR))

_common = {"domain": SITE_DOMAIN, "max_mb": MAX_MB, "base": BASE_PATH}

_d_404_limiter = SlidingWindowRateLimiter(limit=30, window_s=60.0)

_TRUSTED_PROXY_NETS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
_trusted_proxy_env = os.environ.get("TRUSTED_PROXY_NETS", "127.0.0.1/32,::1/128")
for _net in _trusted_proxy_env.split(","):
    _net = _net.strip()
    if not _net:
        continue
    try:
        _TRUSTED_PROXY_NETS.append(ipaddress.ip_network(_net, strict=False))
    except ValueError:
        continue


def _is_trusted_proxy(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(ip in net for net in _TRUSTED_PROXY_NETS)


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    if peer and _is_trusted_proxy(peer):
        xff = request.headers.get("x-forwarded-for")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
    if peer:
        return peer
    return "unknown"


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        "admin/index.html", {"request": request, **_common},
    )


@router.get("/manage", response_class=HTMLResponse)
def manage_page(request: Request):
    return templates.TemplateResponse(
        "admin/index.html", {"request": request, **_common},
    )


def _render_album(request: Request, token: str):
    """Shared album renderer for both /album/{token} and /d/{token}."""
    token = safe_token(token)
    real_path = resolve_slug(token)
    if real_path:
        files = list_images_by_path(real_path)
        display_name = real_path.split("/")[-1]
        record_visit(token)
        return templates.TemplateResponse(
            "album/index.html",
            {
                "request": request,
                "token": token,
                "files": files,
                "files_json": json.dumps(files, ensure_ascii=False),
                "title": display_name,
                "count": len(files),
                "real_path": real_path,
                **_common,
            },
        )
    files = list_images(token)
    if not files:
        raise HTTPException(status_code=404, detail="album not found")
    title = get_token_title(token) or token
    record_visit(token)
    return templates.TemplateResponse(
        "album/index.html",
        {
            "request": request,
            "token": token,
            "files": files,
            "files_json": json.dumps(files, ensure_ascii=False),
            "title": title,
            "count": len(files),
            **_common,
        },
    )


@router.get("/album/{token}", response_class=HTMLResponse)
def album(request: Request, token: str):
    return _render_album(request, token)


@router.get("/d/{token}", response_class=HTMLResponse)
def album_short(request: Request, token: str):
    """Short URL for album — no Caddy rewrite needed."""
    try:
        return _render_album(request, token)
    except HTTPException as e:
        if e.status_code != 404:
            raise
        ip = _client_ip(request)
        if not _d_404_limiter.allow(ip):
            raise HTTPException(status_code=429, detail="too many requests")
        raise
