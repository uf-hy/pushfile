from fastapi import APIRouter, Header
from app.auth import auth_header_key
from app.storage import build_tree, get_all_stats, get_daily_views, infer_token_title

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _looks_technical_title(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if len(text) >= 10 and text.lower().startswith("a-"):
        suffix = text[2:]
        if suffix and all(ch in "0123456789abcdef-" for ch in suffix.lower()):
            return True
    if len(text) >= 10 and all(ch in "0123456789abcdef_-" for ch in text.lower()):
        return True
    return False


def _readable_title(token: str) -> str:
    title = str(infer_token_title(token) or token).strip()
    if _looks_technical_title(title):
        return "未命名画廊"
    return title


def _tree_metrics() -> tuple[int, int]:
    photo_count = 0
    album_count = 0

    def as_int(value: object) -> int:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            try:
                return int(value or "0")
            except Exception:
                return 0
        return 0

    def walk(nodes: list[dict[str, object]]):
        nonlocal photo_count, album_count
        for node in nodes or []:
            image_count = as_int(node.get("image_count", 0))
            photo_count += image_count
            if image_count > 0:
                album_count += 1
            children = node.get("children")
            if isinstance(children, list):
                walk(children)

    walk(build_tree())
    return photo_count, album_count
@router.get("")
def api_stats(key: str | None = None, x_upload_key: str | None = Header(default=None)):
    auth_header_key(x_upload_key or key)
    return get_all_stats()


@router.get("/dashboard")
def api_dashboard(key: str | None = None, x_upload_key: str | None = Header(default=None)):
    """返回 Dashboard 页面需要的所有统计数据"""
    auth_header_key(x_upload_key or key)

    stats = get_all_stats()
    total_photos, album_count = _tree_metrics()

    daily_views = get_daily_views(days=7)
    today_visits = int(daily_views[-1]["views"]) if daily_views else 0
    total_visits = 0
    for _sk, entry in stats.items():
        if isinstance(entry, dict):
            total_visits += int(entry.get("views", 0) or 0)

    activities = []
    for sk, entry in stats.items():
        if isinstance(entry, dict) and "last_visit" in entry:
            token = str(sk or "")
            title = _readable_title(token)
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
    return {"ok": True, "days": get_daily_views(days=7)}
