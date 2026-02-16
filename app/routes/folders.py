import shutil
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from app.auth import safe_path, resolve_dir, auth_header_key, auth_query_key
from app.storage import build_tree, list_images_by_path
from app.config import BASE_DIR

router = APIRouter(prefix="/api/folders", tags=["folders"])


class CreateFolderPayload(BaseModel):
    path: str


class DeleteFolderPayload(BaseModel):
    path: str


class MoveFolderPayload(BaseModel):
    path: str
    dest: str = ""


@router.get("/tree")
def api_folder_tree(key: str):
    auth_query_key(key)
    return {"ok": True, "tree": build_tree()}


@router.get("/list")
def api_folder_list(path: str, key: str):
    auth_query_key(key)
    path = safe_path(path)
    d = resolve_dir(path)
    if not d.exists():
        raise HTTPException(status_code=404, detail="folder not found")
    return {
        "ok": True,
        "path": path,
        "files": list_images_by_path(path),
        "subfolders": sorted(
            p.name for p in d.iterdir()
            if p.is_dir() and not p.name.startswith(("_", "."))
        ),
    }


@router.post("/create")
def api_folder_create(
    payload: CreateFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    d = resolve_dir(path)
    d.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": path}


@router.post("/delete")
def api_folder_delete(
    payload: DeleteFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    d = resolve_dir(path)
    if not d.exists():
        raise HTTPException(status_code=404, detail="folder not found")
    if not d.is_dir():
        raise HTTPException(status_code=400, detail="not a folder")
    shutil.rmtree(d)
    return {"ok": True, "path": path}


@router.post("/move")
def api_folder_move(
    payload: MoveFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)

    src_path = safe_path(payload.path)
    src_dir = resolve_dir(src_path)
    if not src_dir.exists():
        raise HTTPException(status_code=404, detail="folder not found")
    if not src_dir.is_dir():
        raise HTTPException(status_code=400, detail="not a folder")

    dest_raw = (payload.dest or "").strip().strip("/")
    if dest_raw:
        dest_path = safe_path(dest_raw)
        dest_dir = resolve_dir(dest_path)
    else:
        dest_path = ""
        dest_dir = BASE_DIR

    if not dest_dir.exists():
        raise HTTPException(status_code=404, detail="dest folder not found")
    if not dest_dir.is_dir():
        raise HTTPException(status_code=400, detail="dest is not a folder")

    if dest_dir == src_dir or dest_dir.is_relative_to(src_dir):
        raise HTTPException(status_code=400, detail="cannot move folder into itself")

    new_path = f"{dest_path}/{src_dir.name}" if dest_path else src_dir.name
    target_dir = resolve_dir(new_path)

    if src_dir == target_dir:
        return {"ok": True, "path": src_path, "dest": dest_path, "new_path": src_path}

    if target_dir.exists():
        raise HTTPException(status_code=409, detail="target already exists")

    try:
        shutil.move(str(src_dir), str(target_dir))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"move failed: {e}") from e

    return {"ok": True, "path": src_path, "dest": dest_path, "new_path": new_path}
