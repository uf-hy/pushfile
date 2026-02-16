import json
import os
import ipaddress
import time
from threading import Lock
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from app.auth import safe_token
from app.storage import list_images, get_token_title, record_visit, resolve_slug, list_images_by_path
from app.config import FRONTEND_DIR, SITE_DOMAIN, MAX_MB, BASE_PATH

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory=str(FRONTEND_DIR))

_common = {"domain": SITE_DOMAIN, "max_mb": MAX_MB, "base": BASE_PATH}

_D_404_LIMIT = 30
_D_404_WINDOW_S = 60.0
_d_404_state: dict[str, tuple[float, int]] = {}
_d_404_lock = Lock()


def _d_404_allow(key: str, now: float | None = None) -> bool:
    key = key or "unknown"
    if now is None:
        now = time.time()
    with _d_404_lock:
        window_start, count = _d_404_state.get(key, (now, 0))
        if (now - window_start) >= _D_404_WINDOW_S:
            window_start, count = now, 0
        if count >= _D_404_LIMIT:
            return False
        _d_404_state[key] = (window_start, count + 1)
        return True

_TRUSTED_PROXY_NETS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
_trusted_proxy_env = os.environ.get(
    "TRUSTED_PROXY_NETS",
    "127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7,fe80::/10",
)
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


def _parse_ip(value: str) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    peer_ip = _parse_ip(peer)
    if peer_ip and _is_trusted_proxy(peer_ip):
        xff = request.headers.get("x-forwarded-for") or ""
        if xff:
            chain: list[str] = []
            for part in xff.split(","):
                ip = _parse_ip(part)
                if ip:
                    chain.append(ip)
            if chain:
                while chain and _is_trusted_proxy(chain[-1]):
                    chain.pop()
                if chain:
                    return chain[-1]
        x_real_ip = _parse_ip(request.headers.get("x-real-ip") or "")
        if x_real_ip:
            return x_real_ip
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
        if not _d_404_allow(ip):
            raise HTTPException(status_code=429, detail="too many requests")
        raise
