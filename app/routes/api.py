from fastapi import APIRouter, Header

from app.auth import auth_header_key
from app.storage import get_analytics

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
def api_analytics(
    key: str | None = None,
    include_local: bool = False,
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key or key)
    return get_analytics(limit=1000, include_local=include_local)
