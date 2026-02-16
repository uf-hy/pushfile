from fastapi import APIRouter, Header
from app.auth import auth_header_key
from app.storage import get_all_stats

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def api_stats(key: str | None = None, x_upload_key: str | None = Header(default=None)):
    auth_header_key(x_upload_key or key)
    return get_all_stats()
