import json
import ipaddress
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from app.auth import safe_token
from app.storage import list_images, get_token_title, record_visit, resolve_slug, list_images_by_path
from app.config import FRONTEND_DIR, SITE_DOMAIN, MAX_MB, BASE_PATH, APP_VERSION, APP_BUILD_TIME

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory=str(FRONTEND_DIR))

_common = {
    "domain": SITE_DOMAIN,
    "max_mb": MAX_MB,
    "base": BASE_PATH,
    "app_version": APP_VERSION,
    "app_build_time": APP_BUILD_TIME,
}


def _client_ip(request: Request) -> str:
    candidates = []
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        candidates.extend([x.strip() for x in xff.split(",") if x.strip()])
    xrip = (request.headers.get("x-real-ip") or "").strip()
    if xrip:
        candidates.append(xrip)
    if request.client and request.client.host:
        candidates.append(request.client.host)

    first = ""
    for ip in candidates:
        if not first:
            first = ip
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified:
            continue
        return ip
    return first


def _record_visit_compat(request: Request, token: str) -> None:
    try:
        record_visit(token, _client_ip(request), request.headers.get("user-agent") or "")
    except Exception:
        pass


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


@router.get("/album/{token}", response_class=HTMLResponse)
def album(request: Request, token: str):
    token = safe_token(token)
    real_path = resolve_slug(token)
    if real_path:
        files = list_images_by_path(real_path)
        display_name = real_path.split("/")[-1]
        _record_visit_compat(request, token)
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
    _record_visit_compat(request, token)
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


@router.get("/d/{token}", response_class=HTMLResponse)
def album_shortlink(request: Request, token: str):
    return album(request, token)
