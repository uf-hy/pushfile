import hashlib
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException, Header
from app.auth import safe_token, safe_name, safe_path, auth_query_key, auth_header_key, token_dir, resolve_dir, SAFE_NAME_RE
from app.models import (
    RenamePayload,
    DeletePayload,
    BatchDeletePayload,
    BatchMovePayload,
    BatchRenamePayload,
    OrderPayload,
    TokenMetaPayload,
)
from app.storage import (
    list_images,
    get_token_title,
    set_token_title,
    update_order,
    rename_in_order,
    remove_in_order,
    ALLOWED_SUFFIX,
)

router = APIRouter(prefix="/api/manage", tags=["manage"])


@router.get("/{token}")
def api_manage_list(token: str, key: str):
    auth_query_key(key)
    token = safe_token(token)
    return {
        "ok": True,
        "token": token,
        "title": get_token_title(token),
        "files": list_images(token),
    }


@router.post("/{token}/meta")
def api_manage_meta(
    token: str,
    payload: TokenMetaPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    set_token_title(token, payload.title)
    return {"ok": True, "token": token, "title": get_token_title(token)}


@router.post("/{token}/order")
def api_manage_order(
    token: str, payload: OrderPayload, x_upload_key: str | None = Header(default=None)
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    update_order(token, [safe_name(x) for x in payload.names])
    return {"ok": True, "token": token, "files": list_images(token)}


@router.post("/{token}/rename")
def api_manage_rename(
    token: str,
    payload: RenamePayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    old_name = safe_name(payload.oldName)
    new_name = safe_name(payload.newName)
    d = token_dir(token)
    src = (d / old_name).resolve()
    if not str(src).startswith(str(d)) or not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail="source file not found")
    old_ext = src.suffix.lower()
    if old_ext not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=400, detail="file type not allowed")
    dst_name = new_name if Path(new_name).suffix else (new_name + old_ext)
    if Path(dst_name).suffix.lower() not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=400, detail="invalid extension")
    dst = (d / dst_name).resolve()
    if not str(dst).startswith(str(d)):
        raise HTTPException(status_code=400, detail="invalid destination")
    if dst.exists():
        raise HTTPException(status_code=409, detail="target filename exists")
    src.rename(dst)
    rename_in_order(token, old_name, dst.name)
    return {"ok": True, "old": old_name, "new": dst.name}


@router.post("/{token}/delete")
def api_manage_delete(
    token: str,
    payload: DeletePayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    name = safe_name(payload.name)
    d = token_dir(token)
    f = (d / name).resolve()
    if not str(f).startswith(str(d)) or not f.exists() or not f.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if f.suffix.lower() not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=400, detail="file type not allowed")
    f.unlink()
    remove_in_order(token, name)
    return {"ok": True, "deleted": name}


@router.post("/{token}/batch-delete")
def api_manage_batch_delete(
    token: str,
    payload: BatchDeletePayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    names = [safe_name(x) for x in payload.names]
    d = token_dir(token)
    deleted = []
    for name in names:
        f = (d / name).resolve()
        if (
            str(f).startswith(str(d))
            and f.exists()
            and f.is_file()
            and f.suffix.lower() in ALLOWED_SUFFIX
        ):
            f.unlink()
            deleted.append(name)
            remove_in_order(token, name)
    return {"ok": True, "deleted": deleted, "count": len(deleted)}


@router.post("/{token}/batch-move")
def api_manage_batch_move(
    token: str,
    payload: BatchMovePayload,
    x_upload_key: str | None = Header(default=None),
):
    """Move selected files to another folder. Creates dest if needed."""
    auth_header_key(x_upload_key)
    token = safe_token(token)
    dest_path = safe_path(payload.dest)
    names = [safe_name(x) for x in payload.names]
    src_dir = token_dir(token).resolve()
    dst_dir = resolve_dir(dest_path)

    # Block move-to-self
    if dst_dir.resolve() == src_dir:
        raise HTTPException(status_code=400, detail="cannot move to same folder")

    # Block if dest exists but is not a directory
    if dst_dir.exists() and not dst_dir.is_dir():
        raise HTTPException(status_code=400, detail="destination is not a folder")

    dst_dir.mkdir(parents=True, exist_ok=True)
    moved = []
    skipped = []
    for name in names:
        src = (src_dir / name).resolve()
        if not src.is_relative_to(src_dir) or not src.is_file():
            skipped.append({"name": name, "reason": "not found"})
            continue
        if src.suffix.lower() not in ALLOWED_SUFFIX:
            skipped.append({"name": name, "reason": "type not allowed"})
            continue
        dst = dst_dir / name
        final_name = name
        if dst.exists():
            stem = dst.stem
            ext = dst.suffix
            i = 1
            while dst.exists():
                final_name = f"{stem}_{i}{ext}"
                dst = dst_dir / final_name
                i += 1
        try:
            import shutil
            shutil.move(str(src), str(dst))
        except Exception as e:
            skipped.append({"name": name, "reason": str(e)})
            continue
        remove_in_order(token, name)
        moved.append({"src": name, "dst": final_name})
    return {"ok": True, "moved": moved, "count": len(moved), "skipped": skipped, "dest": dest_path}


@router.post("/{token}/batch-rename")
def api_manage_batch_rename(
    token: str,
    payload: BatchRenamePayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    names = [safe_name(x) for x in payload.names]
    prefix = safe_name(payload.prefix)
    start = int(payload.start)
    padding = max(1, min(int(payload.padding), 6))
    d = token_dir(token)
    existing = set(list_images(token))
    selected = [x for x in names if x in existing]
    if not selected:
        return {"ok": True, "renamed": []}
    mapping = {}
    targets = []
    for idx, old in enumerate(selected):
        ext = Path(old).suffix.lower()
        num = str(start + idx).zfill(padding)
        new_name = f"{prefix}-{num}{ext}"
        if not SAFE_NAME_RE.match(new_name):
            raise HTTPException(
                status_code=400, detail=f"invalid target name: {new_name}"
            )
        targets.append(new_name)
        mapping[old] = new_name
    if len(set(targets)) != len(targets):
        raise HTTPException(status_code=409, detail="generated names conflict")
    unselected = existing - set(selected)
    for t in targets:
        if t in unselected:
            raise HTTPException(status_code=409, detail=f"target exists: {t}")
    temp_map = {}
    for old in selected:
        src = (d / old).resolve()
        tmp = (
            d
            / (
                ".__tmp__"
                + hashlib.md5((old + str(time.time())).encode()).hexdigest()
                + Path(old).suffix
            )
        ).resolve()
        src.rename(tmp)
        temp_map[old] = tmp
    for old in selected:
        dst = (d / mapping[old]).resolve()
        temp_map[old].rename(dst)
        rename_in_order(token, old, mapping[old])
    return {"ok": True, "renamed": [{"old": k, "new": v} for k, v in mapping.items()]}
