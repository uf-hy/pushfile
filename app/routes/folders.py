import shutil
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from app.auth import safe_path, resolve_dir, auth_header_key, auth_query_key
from app.storage import (
    build_tree,
    list_images_by_path,
    move_folder_to_trash,
    ordered_child_dirs,
    search_manager_items,
    remove_slug_paths,
    rename_slug_paths,
    rename_subfolder_in_order,
    reorder_subfolder,
    remove_subfolder_from_order,
)
from app.users import get_current_root

router = APIRouter(prefix="/api/folders", tags=["folders"])


class CreateFolderPayload(BaseModel):
    path: str


class DeleteFolderPayload(BaseModel):
    path: str


class MoveFolderPayload(BaseModel):
    path: str
    dest: str = ""
    before: str | None = None


class RenameFolderPayload(BaseModel):
    path: str
    new_name: str


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
        "subfolders": [p.name for p in ordered_child_dirs(d)],
    }


@router.get("/search")
def api_folder_search(query: str, key: str, path: str = "", scope: str = "subtree"):
    auth_query_key(key)
    normalized_path = ""
    if path:
        normalized_path = safe_path(path)
    scope_value = "global" if scope == "global" else "subtree"
    return {
        "ok": True,
        "query": str(query or "").strip(),
        "scope": scope_value,
        "path": normalized_path,
        "results": search_manager_items(query=query, path=normalized_path, scope=scope_value),
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
    trash_item = move_folder_to_trash(path)
    return {"ok": True, "path": path, "mode": "trash", "trash_item": trash_item}


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
        dest_dir = get_current_root().resolve()

    before_raw = (payload.before or "").strip().strip("/")
    before_path = safe_path(before_raw) if before_raw else ""
    before_dir = None
    if before_path == src_path:
        before_path = ""

    if not dest_dir.exists():
        raise HTTPException(status_code=404, detail="dest folder not found")
    if not dest_dir.is_dir():
        raise HTTPException(status_code=400, detail="dest is not a folder")

    if dest_dir == src_dir or dest_dir.is_relative_to(src_dir):
        raise HTTPException(status_code=400, detail="cannot move folder into itself")

    if before_path:
        before_parent = "/".join(before_path.split("/")[:-1])
        if before_parent != dest_path:
            raise HTTPException(status_code=400, detail="invalid before")
        before_dir = resolve_dir(before_path)
        if not before_dir.exists() or not before_dir.is_dir():
            raise HTTPException(status_code=404, detail="before folder not found")

    new_path = f"{dest_path}/{src_dir.name}" if dest_path else src_dir.name
    target_dir = resolve_dir(new_path)

    if src_dir == target_dir:
        if before_path:
            reorder_subfolder(dest_dir, src_dir.name, before_name=before_dir.name if before_dir else None)
        return {"ok": True, "path": src_path, "dest": dest_path, "new_path": src_path}

    if target_dir.exists():
        raise HTTPException(status_code=409, detail="target already exists")

    try:
        old_parent_dir = src_dir.parent
        shutil.move(str(src_dir), str(target_dir))
        remove_subfolder_from_order(old_parent_dir, src_dir.name)
        reorder_subfolder(dest_dir, target_dir.name, before_name=(before_dir.name if before_dir else None))
        rename_slug_paths(src_path, new_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"move failed: {e}") from e

    return {"ok": True, "path": src_path, "dest": dest_path, "new_path": new_path}


@router.post("/rename")
def api_folder_rename(
    payload: RenameFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)

    src_path = safe_path(payload.path)
    src_dir = resolve_dir(src_path)
    if not src_dir.exists():
        raise HTTPException(status_code=404, detail="folder not found")
    if not src_dir.is_dir():
        raise HTTPException(status_code=400, detail="not a folder")

    new_name = (payload.new_name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new name required")
    if "/" in new_name or "\\" in new_name:
        raise HTTPException(status_code=400, detail="invalid folder name")

    parent_path = "/".join(src_path.split("/")[:-1])
    new_path = f"{parent_path}/{new_name}" if parent_path else new_name
    new_path = safe_path(new_path)
    target_dir = resolve_dir(new_path)

    if target_dir == src_dir:
        return {"ok": True, "path": src_path, "new_path": src_path}
    if target_dir.exists():
        raise HTTPException(status_code=409, detail="target already exists")

    try:
        shutil.move(str(src_dir), str(target_dir))
        rename_subfolder_in_order(target_dir.parent, src_dir.name, target_dir.name)
        rename_slug_paths(src_path, new_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"rename failed: {e}") from e

    return {"ok": True, "path": src_path, "new_path": new_path}
