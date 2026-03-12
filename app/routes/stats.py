from datetime import datetime

from fastapi import APIRouter, Header
from app.auth import auth_header_key
from app.storage import get_all_stats, list_tokens_with_counts

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def api_stats(key: str | None = None, x_upload_key: str | None = Header(default=None)):
    auth_header_key(x_upload_key or key)
    return get_all_stats()


@router.get("/dashboard")
def api_dashboard(key: str | None = None, x_upload_key: str | None = Header(default=None)):
    """返回 Dashboard 页面需要的所有统计数据"""
    auth_header_key(x_upload_key or key)

    tokens = list_tokens_with_counts()
    stats = get_all_stats()

    total_photos = sum(int(t.get("count", 0) or 0) for t in tokens)
    album_count = len(tokens)

    today = datetime.now().strftime("%Y-%m-%d")
    today_visits = 0
    total_visits = 0
    for _sk, entry in stats.items():
        if isinstance(entry, dict):
            total_visits += int(entry.get("views", 0) or 0)
            last_visit = str(entry.get("last_visit", "") or "")
            if last_visit.startswith(today):
                today_visits += int(entry.get("views", 0) or 0)

    activities = []
    for sk, entry in stats.items():
        if isinstance(entry, dict) and "last_visit" in entry:
            activities.append(
                {
                    "name": sk,
                    "views": int(entry.get("views", 0) or 0),
                    "last_visit": str(entry.get("last_visit", "") or ""),
                }
            )
    activities.sort(key=lambda x: x["last_visit"], reverse=True)

    return {
        "ok": True,
        "photo_count": total_photos,
        "album_count": album_count,
        "total_visits": total_visits,
        "today_visits": today_visits,
        "recent_activities": activities[:10],
    }
