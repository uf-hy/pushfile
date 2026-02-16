import json
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
        record_visit(real_path)
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
    return _render_album(request, token)
