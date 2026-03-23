from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.auth import auth_header_key, auth_query_key
from app.storage import delete_trashed_item, list_trash_items, restore_trash_item

router = APIRouter(prefix="/api/trash", tags=["trash"])


class TrashItemPayload(BaseModel):
    id: int


@router.get("")
def api_trash_list(
    key: str | None = None,
    x_upload_key: str | None = Header(default=None),
):
    if key:
        auth_query_key(key)
    else:
        auth_header_key(x_upload_key)
    return {"ok": True, "items": list_trash_items()}


@router.post("/restore")
def api_trash_restore(
    payload: TrashItemPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    try:
        return restore_trash_item(payload.id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/delete")
def api_trash_delete(
    payload: TrashItemPayload,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    try:
        return delete_trashed_item(payload.id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
