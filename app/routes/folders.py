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
    src: str
    dst: str


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
    """Move/rename a folder within BASE_DIR.

    Blocks moving a folder into itself or into its own subdirectory.
    """
    auth_header_key(x_upload_key)
    src_path = safe_path(payload.src)
    dst_path = safe_path(payload.dst)

    src = resolve_dir(src_path).resolve()
    dst = resolve_dir(dst_path).resolve()

    if not src.exists():
        raise HTTPException(status_code=404, detail="source folder not found")
    if not src.is_dir():
        raise HTTPException(status_code=400, detail="source is not a folder")

    if dst == src or dst.is_relative_to(src):
        raise HTTPException(status_code=400, detail="cannot move folder into itself")

    if dst.exists():
        raise HTTPException(status_code=409, detail="destination exists")

    if not src.is_relative_to(BASE_DIR) or not dst.is_relative_to(BASE_DIR):
        raise HTTPException(status_code=400, detail="invalid path")

    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        src.rename(dst)
    except OSError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "src": src_path, "dst": dst_path}
