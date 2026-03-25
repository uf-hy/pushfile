import shutil
from pathlib import Path
from typing import NoReturn
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from app.auth import safe_name, safe_path, resolve_dir, auth_header_key, auth_query_key
from app.storage import (
    build_tree,
    copy_file_between_folders,
    copy_folder,
    list_images_by_path,
    move_file_to_trash,
    move_file_between_folders,
    move_folder_to_trash,
    ordered_child_dirs,
    search_manager_items,
    rename_slug_paths,
    rename_file_in_folder,
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


class CopyFolderPayload(BaseModel):
    path: str
    dest: str = ""


class BatchFolderPayload(BaseModel):
    paths: list[str]


class BatchMoveFolderPayload(BaseModel):
    paths: list[str]
    dest: str = ""


class FolderFilePayload(BaseModel):
    path: str
    name: str


class FolderRenameFilePayload(BaseModel):
    path: str
    old_name: str
    new_name: str


class FolderBatchFilesPayload(BaseModel):
    path: str
    names: list[str]


class FolderBatchMoveFilesPayload(BaseModel):
    path: str
    names: list[str]
    dest: str


def _normalize_dest_path(raw: str) -> tuple[str, Path]:
    dest_raw = (raw or "").strip().strip("/")
    dest_dir: Path
    if dest_raw:
        dest_path = safe_path(dest_raw)
        dest_dir = resolve_dir(dest_path)
    else:
        dest_path = ""
        dest_dir = Path(get_current_root().resolve())
    return dest_path, dest_dir


def _raise_storage_error(error: Exception) -> NoReturn:
    if isinstance(error, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, FileExistsError):
        raise HTTPException(status_code=409, detail=str(error)) from error
    if isinstance(error, ValueError):
        raise HTTPException(status_code=400, detail=str(error)) from error
    raise HTTPException(status_code=500, detail=str(error)) from error


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

    dest_path, dest_dir = _normalize_dest_path(payload.dest)

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


@router.post("/copy")
def api_folder_copy(
    payload: CopyFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)

    src_path = safe_path(payload.path)
    dest_path, dest_dir = _normalize_dest_path(payload.dest)
    if not dest_dir.exists():
        raise HTTPException(status_code=404, detail="dest folder not found")
    if not dest_dir.is_dir():
        raise HTTPException(status_code=400, detail="dest is not a folder")

    try:
        result = copy_folder(src_path, dest_path)
    except Exception as error:
        _raise_storage_error(error)
    else:
        return {"ok": True, **result}


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


@router.post("/batch-delete")
def api_folder_batch_delete(
    payload: BatchFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    deleted = []
    trashed = []
    skipped = []
    for raw_path in payload.paths:
        try:
            path = safe_path(raw_path)
            trash_item = move_folder_to_trash(path)
            deleted.append(path)
            trashed.append(trash_item)
        except Exception as error:
            skipped.append({"path": str(raw_path or ""), "reason": str(error)})
    return {"ok": True, "deleted": deleted, "count": len(deleted), "mode": "trash", "trash_items": trashed, "skipped": skipped}


@router.post("/batch-move")
def api_folder_batch_move(
    payload: BatchMoveFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    dest_path, _dest_dir = _normalize_dest_path(payload.dest)
    moved = []
    skipped = []
    for raw_path in payload.paths:
        try:
            result = api_folder_move(MoveFolderPayload(path=raw_path, dest=dest_path), x_upload_key=x_upload_key)
            moved.append({"path": result["path"], "new_path": result["new_path"]})
        except HTTPException as error:
            skipped.append({"path": str(raw_path or ""), "reason": str(error.detail)})
    return {"ok": True, "moved": moved, "count": len(moved), "dest": dest_path, "skipped": skipped}


@router.post("/batch-copy")
def api_folder_batch_copy(
    payload: BatchMoveFolderPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    dest_path, _dest_dir = _normalize_dest_path(payload.dest)
    copied = []
    skipped = []
    for raw_path in payload.paths:
        try:
            path = safe_path(raw_path)
            result = copy_folder(path, dest_path)
            copied.append({"path": result["path"], "new_path": result["new_path"]})
        except Exception as error:
            skipped.append({"path": str(raw_path or ""), "reason": str(error)})
    return {"ok": True, "copied": copied, "count": len(copied), "dest": dest_path, "skipped": skipped}


@router.post("/file-rename")
def api_folder_file_rename(
    payload: FolderRenameFilePayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    old_name = safe_name(payload.old_name)
    new_name = safe_name(payload.new_name)
    try:
        result = rename_file_in_folder(path, old_name, new_name)
    except Exception as error:
        _raise_storage_error(error)
    else:
        return {"ok": True, **result}


@router.post("/file-delete")
def api_folder_file_delete(
    payload: FolderFilePayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    name = safe_name(payload.name)
    trash_item = move_file_to_trash(path, name)
    return {"ok": True, "deleted": name, "path": path, "mode": "trash", "trash_item": trash_item}


@router.post("/files-delete")
def api_folder_files_delete(
    payload: FolderBatchFilesPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    deleted = []
    trashed = []
    skipped = []
    for raw_name in payload.names:
        try:
            name = safe_name(raw_name)
            trash_item = move_file_to_trash(path, name)
            deleted.append(name)
            trashed.append(trash_item)
        except Exception as error:
            skipped.append({"name": str(raw_name or ""), "reason": str(error)})
    return {"ok": True, "deleted": deleted, "count": len(deleted), "path": path, "mode": "trash", "trash_items": trashed, "skipped": skipped}


@router.post("/files-move")
def api_folder_files_move(
    payload: FolderBatchMoveFilesPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    dest = safe_path(payload.dest)
    moved = []
    skipped = []
    for raw_name in payload.names:
        try:
            name = safe_name(raw_name)
            moved.append(move_file_between_folders(path, name, dest))
        except Exception as error:
            skipped.append({"name": str(raw_name or ""), "reason": str(error)})
    return {"ok": True, "moved": moved, "count": len(moved), "path": path, "dest": dest, "skipped": skipped}


@router.post("/files-copy")
def api_folder_files_copy(
    payload: FolderBatchMoveFilesPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    path = safe_path(payload.path)
    dest = safe_path(payload.dest)
    copied = []
    skipped = []
    for raw_name in payload.names:
        try:
            name = safe_name(raw_name)
            copied.append(copy_file_between_folders(path, name, dest))
        except Exception as error:
            skipped.append({"name": str(raw_name or ""), "reason": str(error)})
    return {"ok": True, "copied": copied, "count": len(copied), "path": path, "dest": dest, "skipped": skipped}
