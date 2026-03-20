from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header
from app.auth import auth_header_key
from app.storage import get_all_stats, list_tokens_with_counts, infer_token_title, iter_visit_records

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _count_daily_views(days: int = 7) -> list[dict[str, int | str]]:
    days = max(1, int(days or 7))
    bjt = timezone(timedelta(hours=8))
    today = datetime.now(bjt).date()
    start_day = today - timedelta(days=days - 1)
    day_counts: dict[str, int] = {}

    for rec in iter_visit_records():
        t = str(rec.get("time") or "")
        if not t:
            continue
        try:
            dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=bjt)
        day = dt.astimezone(bjt).date()
        if start_day <= day <= today:
            key = day.isoformat()
            day_counts[key] = int(day_counts.get(key, 0)) + 1

    result: list[dict[str, int | str]] = []
    for i in range(days):
        day = start_day + timedelta(days=i)
        key = day.isoformat()
        result.append({"date": key, "views": int(day_counts.get(key, 0))})
    return result


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

    daily_views = _count_daily_views(days=7)
    today_visits = int(daily_views[-1]["views"]) if daily_views else 0
    total_visits = 0
    for _sk, entry in stats.items():
        if isinstance(entry, dict):
            total_visits += int(entry.get("views", 0) or 0)

    activities = []
    for sk, entry in stats.items():
        if isinstance(entry, dict) and "last_visit" in entry:
            token = str(sk or "")
            title = infer_token_title(token) or token
            activities.append(
                {
                    "name": token,
                    "title": title,
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


@router.get("/daily")
def api_daily_stats(key: str | None = None, x_upload_key: str | None = Header(default=None)):
    auth_header_key(x_upload_key or key)
    return {"ok": True, "days": _count_daily_views(days=7)}
