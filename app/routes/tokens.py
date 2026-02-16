import shutil
from datetime import datetime
from fastapi import APIRouter, HTTPException, Header
from app.auth import safe_token, auth_query_key, auth_header_key, token_dir
from app.models import CreateTokenPayload, RemoveTokenPayload
from app.storage import (
    list_tokens_with_counts,
    list_images,
    save_manifest,
    ARCHIVE_DIRNAME,
)
from app.config import BASE_DIR

router = APIRouter(prefix="/api/tokens", tags=["tokens"])


@router.get("")
def api_tokens(key: str):
    auth_query_key(key)
    return {"ok": True, "tokens": list_tokens_with_counts()}


@router.post("")
def api_tokens_create(
    payload: CreateTokenPayload, x_upload_key: str | None = Header(default=None)
):
    auth_header_key(x_upload_key)
    token = safe_token(payload.token)
    d = token_dir(token)
    d.mkdir(parents=True, exist_ok=True)
    save_manifest(token, {"order": list_images(token)})
    return {"ok": True, "token": token}


@router.post("/{token}/remove")
def api_tokens_remove(
    token: str,
    payload: RemoveTokenPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    d = token_dir(token)
    if not d.exists():
        raise HTTPException(status_code=404, detail="token not found")
    mode = (payload.mode or "archive").lower()
    if mode not in {"archive", "delete"}:
        raise HTTPException(status_code=400, detail="mode must be archive or delete")
    if mode == "delete":
        shutil.rmtree(d)
        return {"ok": True, "mode": "delete", "token": token}
    arc_root = (BASE_DIR / ARCHIVE_DIRNAME).resolve()
    arc_root.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = (arc_root / f"{token}-{ts}").resolve()
    if not str(target).startswith(str(arc_root)):
        raise HTTPException(status_code=400, detail="invalid archive target")
    shutil.move(str(d), str(target))
    return {"ok": True, "mode": "archive", "token": token, "archivedTo": target.name}
