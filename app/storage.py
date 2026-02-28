import hashlib
import json
import os
import threading
import ipaddress
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List
from app.config import BASE_DIR
from app.auth import TOKEN_RE, token_dir, safe_name, resolve_dir

ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MANIFEST = ".manifest.json"
FOLDER_ORDER_FILE = ".folder_order.json"
ARCHIVE_DIRNAME = "_archived"
STATS_FILE = BASE_DIR / "_stats.json"
VISITS_FILE = BASE_DIR / "_visits.jsonl"
VISITS_OLD_FILE = BASE_DIR / "_visits.old.jsonl"
_VISITS_MAX_BYTES = 10 * 1024 * 1024
_IP2REGION_DB_PATH = Path("/app/data/ip2region.xdb")
SLUGS_FILE = BASE_DIR / "_slugs.json"
_stats_lock = threading.Lock()
_visits_lock = threading.Lock()
_slugs_lock = threading.Lock()
_SLUG_SALT = os.environ.get("SLUG_SALT", "xaihub-photo-2026")
_ip2region_lock = threading.Lock()
_ip2region_searcher = None
_ip2region_unavailable = False


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


def _list_visible_child_dirs(d: Path) -> list[Path]:
    if not d.exists():
        return []
    out = []
    for p in d.iterdir():
        if not p.is_dir() or p.name.startswith(("_", ".")) or p.is_symlink():
            continue
        out.append(p)
    return out


def load_subfolder_order(d: Path) -> list[str]:
    p = d / FOLDER_ORDER_FILE
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        return [x for x in data if isinstance(x, str) and x]
    except Exception:
        return []


def save_subfolder_order(d: Path, order: list[str]):
    p = d / FOLDER_ORDER_FILE
    p.write_text(json.dumps(order, ensure_ascii=False, indent=2), encoding="utf-8")


def ordered_child_dirs(d: Path) -> list[Path]:
    children = _list_visible_child_dirs(d)
    by_name = {p.name: p for p in children}
    order = load_subfolder_order(d)
    out: list[Path] = []
    used = set()
    for name in order:
        p = by_name.get(name)
        if p and name not in used:
            out.append(p)
            used.add(name)
    rest = [p for p in children if p.name not in used]
    out.extend(sorted(rest, key=lambda p: p.name))
    return out


def reorder_subfolder(parent_dir: Path, folder_name: str, before_name: str | None = None):
    before_name = (before_name or "").strip() or None
    children = _list_visible_child_dirs(parent_dir)
    existing_names = sorted({p.name for p in children})
    existing_set = set(existing_names)
    if folder_name not in existing_set:
        existing_set.add(folder_name)
        existing_names.append(folder_name)
        existing_names = sorted(set(existing_names))

    prev = load_subfolder_order(parent_dir)
    base: list[str] = []
    seen = set()
    for name in prev:
        if name in existing_set and name != folder_name and name not in seen:
            base.append(name)
            seen.add(name)
    for name in existing_names:
        if name in existing_set and name != folder_name and name not in seen:
            base.append(name)
            seen.add(name)

    idx = len(base)
    if before_name and before_name in base and before_name != folder_name:
        idx = base.index(before_name)
    base.insert(idx, folder_name)
    save_subfolder_order(parent_dir, base)


def remove_subfolder_from_order(parent_dir: Path, folder_name: str):
    children = _list_visible_child_dirs(parent_dir)
    existing_names = sorted({p.name for p in children})
    existing_set = set(existing_names)
    prev = load_subfolder_order(parent_dir)
    base: list[str] = []
    seen = set()
    for name in prev:
        if name in existing_set and name != folder_name and name not in seen:
            base.append(name)
            seen.add(name)
    for name in existing_names:
        if name != folder_name and name not in seen:
            base.append(name)
            seen.add(name)
    save_subfolder_order(parent_dir, base)


def build_tree(root: Path | None = None, rel: str = "") -> list:
    root = root or BASE_DIR
    if not root.exists():
        return []
    items = []
    for p in ordered_child_dirs(root):
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


def _utc_now_z() -> str:
    """UTC time for _stats.json backward compat."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


_BJT = timezone(timedelta(hours=8))


def _now_bjt() -> str:
    """Return current Beijing time (UTC+8) as ISO string."""
    return datetime.now(_BJT).isoformat()


def _is_local_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # Spec mentions common IPv4 private ranges; include IPv6 local too for safety.
    if addr.is_loopback:
        return True
    if addr.version == 4:
        return (
            addr in ipaddress.ip_network("10.0.0.0/8")
            or addr in ipaddress.ip_network("192.168.0.0/16")
            or addr in ipaddress.ip_network("172.16.0.0/12")
        )
    return addr.is_private or addr.is_link_local


def _get_ip2region_searcher():
    """Lazy-init ip2region searcher (content-cached, thread-safe)."""
    global _ip2region_searcher, _ip2region_unavailable
    if _ip2region_unavailable:
        return None
    if _ip2region_searcher is not None:
        return _ip2region_searcher
    with _ip2region_lock:
        if _ip2region_unavailable:
            return None
        if _ip2region_searcher is not None:
            return _ip2region_searcher
        if not _IP2REGION_DB_PATH.exists():
            _ip2region_unavailable = True
            return None
        try:
            import sys, importlib, io
            # ip2region binding is bundled in /app/ip2region/
            ip2r_path = Path("/app/ip2region")
            if ip2r_path.exists() and str(ip2r_path) not in sys.path:
                sys.path.insert(0, str(ip2r_path))
            from ip2region import searcher as ip2r_searcher, util as ip2r_util
            buf = ip2r_util.load_content_from_file(str(_IP2REGION_DB_PATH))
            header = ip2r_util.load_header_from_file(str(_IP2REGION_DB_PATH))
            ver = ip2r_util.version_from_header(header)
            _ip2region_searcher = ip2r_searcher.Searcher(ver, str(_IP2REGION_DB_PATH), None, buf)
            return _ip2region_searcher
        except Exception:
            _ip2region_unavailable = True
            return None


def _geoip_lookup(ip: str) -> tuple[str, str, str]:
    """Lookup IP geolocation. Returns (city, region, country)."""
    if not ip:
        return "", "", ""
    if _is_local_ip(ip):
        return "本地", "", ""
    s = _get_ip2region_searcher()
    if not s:
        return "", "", ""
    try:
        # ip2region returns: "国家|省份|城市|ISP|国家代码"
        # e.g. "中国|湖南省|娄底市|电信|CN"
        result = s.search(ip)
        if not result or result == "0|0|0|0|0":
            return "", "", ""
        parts = str(result).split("|")
        # parts: [country, province, city, isp, country_code]
        country_code = parts[4] if len(parts) > 4 else ""
        region = parts[1] if len(parts) > 1 else ""  # province
        city = parts[2] if len(parts) > 2 else ""     # city
        # Clean up "0" placeholders
        if city == "0":
            city = ""
        if region == "0":
            region = ""
        if country_code == "0":
            country_code = ""
        return city or "", region or "", country_code or ""
    except Exception:
        return "", "", ""


def _rotate_visits_if_needed():
    try:
        if VISITS_FILE.exists() and VISITS_FILE.stat().st_size >= _VISITS_MAX_BYTES:
            try:
                if VISITS_OLD_FILE.exists():
                    VISITS_OLD_FILE.unlink()
            except Exception:
                pass
            try:
                VISITS_FILE.replace(VISITS_OLD_FILE)
            except Exception:
                pass
    except Exception:
        pass


def _append_visit_record(token: str, ip: str, ua: str, time_z: str):
    city, region, country = _geoip_lookup(ip)
    rec = {
        "token": token,
        "ip": ip,
        "city": city,
        "region": region,
        "country": country,
        "ua": ua or "",
        "time": time_z,
    }
    line = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
    with _visits_lock:
        _rotate_visits_if_needed()
        VISITS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(VISITS_FILE, "a", encoding="utf-8") as f:
            f.write(line)


def record_visit(token: str, ip: str, ua: str = "", stats_key: str = ""):
    """Record a visit. stats_key is used for _stats.json (defaults to token)."""
    sk = stats_key or token
    now_utc = _utc_now_z()
    now_bjt = _now_bjt()
    with _stats_lock:
        stats = _load_stats()
        entry = stats.get(sk, {"views": 0, "first_visit": None, "last_visit": None})
        entry["views"] = entry.get("views", 0) + 1
        if not entry.get("first_visit"):
            entry["first_visit"] = now_utc
        entry["last_visit"] = now_utc
        stats[sk] = entry
        _save_stats(stats)
    try:
        _append_visit_record(token=token, ip=ip or "", ua=ua or "", time_z=now_bjt)
    except Exception:
        # Never break album rendering on analytics failures.
        pass


def get_all_stats() -> dict:
    return _load_stats()


def _iter_jsonl(path: Path):
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if isinstance(obj, dict):
                    yield obj
    except Exception:
        return


def iter_visit_records():
    # Old file first, then current file. Both are capped by rotation (10MB each).
    yield from _iter_jsonl(VISITS_OLD_FILE)
    yield from _iter_jsonl(VISITS_FILE)


def get_analytics(limit: int = 1000, include_local: bool = False) -> dict:
    limit = max(1, min(int(limit or 1000), 5000))

    recent = deque(maxlen=limit)
    by_city: Counter[str] = Counter()
    by_date: Counter[str] = Counter()
    by_token: Counter[str] = Counter()
    ip_token: dict[str, Counter[str]] = defaultdict(Counter)
    ip_city: dict[str, Counter[str]] = defaultdict(Counter)
    unique_ips: set[str] = set()
    total = 0
    filtered_local = 0

    for rec in iter_visit_records():
        token = str(rec.get("token") or "")
        ip = str(rec.get("ip") or "")
        if ip and (not include_local) and _is_local_ip(ip):
            filtered_local += 1
            continue

        total += 1
        recent.append(rec)
        city = str(rec.get("city") or "")
        t = str(rec.get("time") or "")
        date = t[:10] if len(t) >= 10 else ""
        if token:
            by_token[token] += 1
        if date:
            by_date[date] += 1
        by_city[city] += 1
        if ip:
            unique_ips.add(ip)
            if token:
                ip_token[ip][token] += 1
            if city:
                ip_city[ip][city] += 1

    cross_visit = []
    for ip, tok_ctr in ip_token.items():
        tokens = [t for t, c in tok_ctr.items() if t and c > 0]
        if len(tokens) < 2:
            continue
        tokens_sorted = [t for t, _ in sorted(tok_ctr.items(), key=lambda x: (-x[1], x[0])) if t]
        city = ""
        if ip in ip_city and ip_city[ip]:
            city = ip_city[ip].most_common(1)[0][0]
        cross_visit.append(
            {
                "ip": ip,
                "city": city,
                "tokens": tokens_sorted,
                "count": int(sum(tok_ctr.values())),
            }
        )
    cross_visit.sort(key=lambda x: (-int(x.get("count") or 0), str(x.get("ip") or "")))

    today = datetime.now(_BJT).date().isoformat()
    today_count = int(by_date.get(today, 0))

    return {
        "visits": list(recent),
        "by_city": dict(by_city),
        "by_date": dict(by_date),
        "by_token": dict(by_token),
        "cross_visit": cross_visit,
        "total_visit_count": int(total),
        "today_visit_count": today_count,
        "unique_ip_count": int(len(unique_ips)),
        "album_count": int(len(by_token)),
        "local_visit_filtered": int(filtered_local),
        "include_local": bool(include_local),
    }


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
