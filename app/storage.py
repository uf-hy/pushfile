import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List
from app.config import BASE_DIR
from app.auth import TOKEN_RE, token_dir, safe_name, resolve_dir

ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MANIFEST = ".manifest.json"
ARCHIVE_DIRNAME = "_archived"
STATS_FILE = BASE_DIR / "_stats.json"
SLUGS_FILE = BASE_DIR / "_slugs.json"
_stats_lock = threading.Lock()
_slugs_lock = threading.Lock()
_SLUG_SALT = os.environ.get("SLUG_SALT", "xaihub-photo-2026")


def list_raw_images(token: str) -> List[str]:
    d = token_dir(token)
    if not d.exists():
        return []
    return [
        p.name
        for p in sorted(d.iterdir())
        if p.is_file() and p.suffix.lower() in ALLOWED_SUFFIX
    ]


def manifest_path(token: str) -> Path:
    return token_dir(token) / MANIFEST


def load_manifest(token: str) -> dict:
    p = manifest_path(token)
    if not p.exists():
        return {"order": [], "title": ""}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"order": [], "title": ""}
        if "order" not in data or not isinstance(data["order"], list):
            data["order"] = []
        if "title" not in data or not isinstance(data["title"], str):
            data["title"] = ""
        return data
    except Exception:
        return {"order": [], "title": ""}


def save_manifest(token: str, data: dict):
    p = manifest_path(token)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_images(token: str) -> List[str]:
    raw = list_raw_images(token)
    data = load_manifest(token)
    order = [x for x in data.get("order", []) if x in raw]
    rest = [x for x in raw if x not in order]
    final = order + rest
    if final != data.get("order", []):
        data["order"] = final
        save_manifest(token, data)
    return final


def get_token_title(token: str) -> str:
    return (load_manifest(token).get("title") or "").strip()


def set_token_title(token: str, title: str):
    d = load_manifest(token)
    d["title"] = (title or "").strip()
    save_manifest(token, d)


def update_order(token: str, names: List[str]):
    existing = list_raw_images(token)
    existing_set = set(existing)
    cleaned = [x for x in names if x in existing_set]
    for x in existing:
        if x not in cleaned:
            cleaned.append(x)
    data = load_manifest(token)
    data["order"] = cleaned
    save_manifest(token, data)


def rename_in_order(token: str, old_name: str, new_name: str):
    arr = list_images(token)
    arr = [new_name if x == old_name else x for x in arr]
    update_order(token, arr)


def remove_in_order(token: str, name: str):
    update_order(token, [x for x in list_images(token) if x != name])


def append_in_order(token: str, name: str):
    arr = list_images(token)
    if name not in arr:
        arr.append(name)
    update_order(token, arr)


def list_tokens_with_counts() -> List[dict]:
    if not BASE_DIR.exists():
        return []
    out = []
    for p in sorted(BASE_DIR.iterdir()):
        if (
            not p.is_dir()
            or p.name.startswith("_")
            or not TOKEN_RE.match(p.name)
        ):
            continue
        count = len(
            [
                x
                for x in p.iterdir()
                if x.is_file() and x.suffix.lower() in ALLOWED_SUFFIX
            ]
        )
        out.append({"token": p.name, "count": count})
    return out


def _count_images(d: Path) -> int:
    return sum(1 for x in d.iterdir() if x.is_file() and x.suffix.lower() in ALLOWED_SUFFIX) if d.exists() else 0


def build_tree(root: Path | None = None, rel: str = "") -> list:
    root = root or BASE_DIR
    if not root.exists():
        return []
    items = []
    for p in sorted(root.iterdir()):
        if not p.is_dir() or p.name.startswith(("_", ".")) or p.is_symlink():
            continue
        child_rel = f"{rel}/{p.name}" if rel else p.name
        children = build_tree(p, child_rel)
        has_images = _count_images(p) > 0
        is_album = has_images and not children
        slug = get_or_create_slug(child_rel) if is_album else None
        node = {
            "name": p.name,
            "path": child_rel,
            "image_count": _count_images(p),
            "is_album": is_album,
            "children": children,
        }
        if slug:
            node["slug"] = slug
        items.append(node)
    return items


def list_images_by_path(path: str) -> List[str]:
    d = resolve_dir(path)
    if not d.exists():
        return []
    raw = sorted(
        p.name for p in d.iterdir()
        if p.is_file() and p.suffix.lower() in ALLOWED_SUFFIX
    )
    manifest_file = d / MANIFEST
    if manifest_file.exists():
        try:
            data = json.loads(manifest_file.read_text(encoding="utf-8"))
            order = [x for x in data.get("order", []) if x in raw]
            rest = [x for x in raw if x not in order]
            return order + rest
        except Exception:
            pass
    return raw


# ── 访问统计 ──

def _load_stats() -> dict:
    if STATS_FILE.exists():
        try:
            return json.loads(STATS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_stats(data: dict):
    STATS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def record_visit(token: str):
    with _stats_lock:
        stats = _load_stats()
        entry = stats.get(token, {"views": 0, "first_visit": None, "last_visit": None})
        now = datetime.now(timezone.utc).isoformat()
        entry["views"] = entry.get("views", 0) + 1
        if not entry.get("first_visit"):
            entry["first_visit"] = now
        entry["last_visit"] = now
        stats[token] = entry
        _save_stats(stats)


def get_all_stats() -> dict:
    return _load_stats()


def _load_slugs() -> dict:
    if SLUGS_FILE.exists():
        try:
            return json.loads(SLUGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"slug_to_path": {}, "path_to_slug": {}}


def _save_slugs(data: dict):
    SLUGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _make_slug(path: str) -> str:
    h = hashlib.sha256((_SLUG_SALT + "|" + path).encode()).hexdigest()[:8]
    return f"a-{h}"


def get_or_create_slug(path: str) -> str:
    with _slugs_lock:
        data = _load_slugs()
        existing = data["path_to_slug"].get(path)
        if existing:
            _ensure_symlink(existing, path)
            return existing
        slug = _make_slug(path)
        data["slug_to_path"][slug] = path
        data["path_to_slug"][path] = slug
        _save_slugs(data)
        _ensure_symlink(slug, path)
        return slug


def _ensure_symlink(slug: str, path: str):
    link = BASE_DIR / slug
    target = BASE_DIR / path
    if link.is_symlink():
        if link.resolve() == target.resolve():
            return
        link.unlink()
    elif link.exists():
        return
    try:
        link.symlink_to(target)
    except OSError:
        pass


def resolve_slug(slug: str) -> str | None:
    data = _load_slugs()
    return data["slug_to_path"].get(slug)


def get_all_slugs() -> dict:
    return _load_slugs()


