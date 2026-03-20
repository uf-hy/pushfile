"""认证相关路由：登录、登出。

当前实现为单 key 模式（UPLOAD_SECRET），后续可扩展为多用户系统。
Cookie 名使用通用前缀 pushfile_ ，便于未来用户系统复用。
"""

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from app.config import UPLOAD_SECRET, SITE_DOMAIN, BASE_PATH

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "pushfile_session"
_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 天


def require_auth(request: Request):
    key = request.cookies.get(COOKIE_NAME)
    if key != UPLOAD_SECRET:
        return RedirectResponse(url="/login", status_code=302)
    return None


class LoginPayload(BaseModel):
    key: str


@router.post("/login")
def api_auth_login(payload: LoginPayload, response: Response):
    if payload.key != UPLOAD_SECRET:
        raise HTTPException(status_code=401, detail="invalid key")

    response.set_cookie(
        key=COOKIE_NAME,
        value=payload.key,
        max_age=_COOKIE_MAX_AGE,
        path=BASE_PATH or "/",
        httponly=True,
        samesite="lax",
        secure=bool(SITE_DOMAIN and not SITE_DOMAIN.startswith("localhost")),
    )
    return {"ok": True}


@router.post("/logout")
def api_auth_logout(response: Response):
    response.delete_cookie(
        key=COOKIE_NAME,
        path=BASE_PATH or "/",
    )
    return {"ok": True}
