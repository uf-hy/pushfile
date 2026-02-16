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
