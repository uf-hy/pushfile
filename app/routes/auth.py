"""认证相关路由：登录、登出。

当前实现为单 key 模式（UPLOAD_SECRET），后续可扩展为多用户系统。
Cookie 名使用通用前缀 pushfile_ ，便于未来用户系统复用。
"""

from fastapi import APIRouter, HTTPException, Request, Response, Header
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from app.config import SITE_DOMAIN, BASE_PATH
from app.auth import auth_header_key
from app.users import (
    authenticate,
    authenticate_credential,
    create_session,
    create_user,
    delete_session,
    get_user_by_session,
    is_admin_user,
    list_users,
    set_current_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "pushfile_session"
_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 天


def require_auth(request: Request):
    session_id = request.cookies.get(COOKIE_NAME)
    user = get_user_by_session(session_id)
    if not user:
        return RedirectResponse(url="/login", status_code=302)
    set_current_user(user)
    return None


class LoginPayload(BaseModel):
    key: str = ""
    username: str = ""
    password: str = ""


class CreateUserPayload(BaseModel):
    username: str
    password: str


def _current_user_or_401(request: Request, credential: str | None = None):
    session_id = request.cookies.get(COOKIE_NAME)
    user = get_user_by_session(session_id)
    if not user and credential:
        user = auth_header_key(credential)
    if not user:
        raise HTTPException(status_code=401, detail="not authenticated")
    set_current_user(user)
    return user


@router.post("/login")
def api_auth_login(payload: LoginPayload, response: Response):
    user = None
    if payload.username or payload.password:
        user = authenticate((payload.username or "").strip() or "admin", payload.password or "")
    else:
        user = authenticate_credential(payload.key)
    if not user:
        raise HTTPException(status_code=401, detail="invalid key")

    session_id = create_session(user["id"])

    response.set_cookie(
        key=COOKIE_NAME,
        value=session_id,
        max_age=_COOKIE_MAX_AGE,
        path=BASE_PATH or "/",
        httponly=True,
        samesite="lax",
        secure=bool(SITE_DOMAIN and not SITE_DOMAIN.startswith("localhost")),
    )
    return {"ok": True, "user": {"id": user["id"], "username": user["username"]}}


@router.post("/logout")
def api_auth_logout(request: Request, response: Response):
    session_id = request.cookies.get(COOKIE_NAME)
    if session_id:
        delete_session(session_id)
    response.delete_cookie(
        key=COOKIE_NAME,
        path=BASE_PATH or "/",
    )
    return {"ok": True}


@router.get("/me")
def api_auth_me(request: Request):
    user = _current_user_or_401(request)
    return {
        "ok": True,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "is_legacy": user["is_legacy"],
            "role": user["role"],
            "is_admin": is_admin_user(user),
        },
    }


@router.get("/users")
def api_auth_users(request: Request, x_upload_key: str | None = Header(default=None), key: str | None = None):
    user = _current_user_or_401(request, x_upload_key or key)
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="admin only")
    items = [
        {"id": item["id"], "username": item["username"], "is_legacy": item["is_legacy"], "is_active": item["is_active"]}
        for item in list_users()
    ]
    return {"ok": True, "users": items}


@router.post("/users")
def api_auth_create_user(
    payload: CreateUserPayload,
    request: Request,
    x_upload_key: str | None = Header(default=None),
):
    user = _current_user_or_401(request, x_upload_key)
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="admin only")
    try:
        created = create_user(payload.username, payload.password)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "user": {"id": created["id"], "username": created["username"]}}
