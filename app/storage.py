import hashlib
import json
import os
import re
import secrets
import shutil
import threading
import ipaddress
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, List
from .analytics_store import get_stats_rollups, iter_sqlite_visit_events, record_sqlite_visit, seed_stats_rollup
from app.config import BASE_DIR, REGION_TRACE_ENABLED, ANALYTICS_READ_SQLITE, ANALYTICS_WRITE_LEGACY, ANALYTICS_WRITE_SQLITE
from app.auth import TOKEN_RE, token_dir, resolve_dir
from app.image_variants import remove_variants_for_source
from app.metadata_store import (
    create_trash_entry,
    delete_trash_entry,
    get_trash_entry,
    list_trash_entries,
    load_folder_order_record,
    load_manifest_record,
    load_slugs_snapshot,
    metadata_backend,
    save_folder_order_record,
    save_manifest_record,
    save_slugs_snapshot,
)
from app.users import (
    LEGACY_USER_ID,
    SYSTEM_DIR,
    apply_user_scope,
    get_current_root,
    get_current_user_id,
    get_root_for_user_id,
    slug_owner_key,
)

ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MANIFEST = ".manifest.json"
FOLDER_ORDER_FILE = ".folder_order.json"
ARCHIVE_DIRNAME = "_archived"
_VISITS_MAX_BYTES = 10 * 1024 * 1024
_IP2REGION_DB_PATH = Path(os.environ.get("IP2REGION_DB", "")) if os.environ.get("IP2REGION_DB") else None
_stats_lock = threading.Lock()
_visits_lock = threading.Lock()
_slugs_lock = threading.Lock()
_SLUG_SALT = os.environ.get("SLUG_SALT", "xaihub-photo-2026")
_ip2region_lock = threading.Lock()
_ip2region_searcher = None
_ip2region_unavailable = False
_analytics_excluded_nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
for _net in (os.environ.get("ANALYTICS_EXCLUDED_NETS") or "").split(","):
    _net = _net.strip()
    if not _net:
        continue
    try:
        _analytics_excluded_nets.append(ipaddress.ip_network(_net, strict=False))
    except ValueError:
        continue


def _current_root() -> Path:
    return get_current_root().resolve()


def _owner_id() -> str:
    return get_current_user_id()


def _stats_file() -> Path:
    return _current_root() / "_stats.json"


def _visits_file() -> Path:
    return _current_root() / "_visits.jsonl"


def _visits_old_file() -> Path:
    return _current_root() / "_visits.old.jsonl"


def _slugs_file() -> Path:
    return (SYSTEM_DIR / "_slugs.json").resolve()


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


def _load_manifest_from_fs(token: str) -> dict[str, Any]:
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


def load_manifest(token: str) -> dict[str, Any]:
    backend = metadata_backend()
    owner = _owner_id()
    if backend == "sqlite":
        record = load_manifest_record(owner, token)
        if record is not None:
            return record
        data = _load_manifest_from_fs(token)
        if data.get("order") or data.get("title"):
            save_manifest_record(owner, token, data)
        return data

    data = _load_manifest_from_fs(token)
    if backend == "dual":
        save_manifest_record(owner, token, data)
    return data


def save_manifest(token: str, data: dict[str, Any]):
    p = manifest_path(token)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if metadata_backend() in {"dual", "sqlite"}:
        save_manifest_record(_owner_id(), token, data)


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


def _looks_like_generated_stem(stem: str) -> bool:
    raw = (stem or "").strip().lower()
    if not raw:
        return True
    if re.fullmatch(r"a-[a-f0-9]{8}", raw):
        return True
    if re.fullmatch(r"\d+", raw):
        return True
    if re.fullmatch(r"\d+-\d+", raw):
        return True
    if re.fullmatch(r"row-\d+-column-\d+", raw):
        return True
    if re.fullmatch(r"row-\d+-column", raw):
        return True
    if raw in {"cover", "image", "img", "photo", "picture"}:
        return True
    return False


def _normalize_candidate_title(stem: str) -> str:
    title = (stem or "").strip()
    title = re.sub(r"\s*\(\d+\)(?:-\d+)?$", "", title)
    title = re.sub(r"-\d+$", "", title)
    return title.strip("-_ ")


def infer_token_title(token: str) -> str:
    explicit = get_token_title(token)
    if explicit:
        return explicit

    resolved_path = resolve_slug(token)
    if resolved_path:
        display_name = resolved_path.split("/")[-1].strip()
        if display_name:
            return display_name

    try:
        names = list_images(token)
    except Exception:
        return ""

    candidates: list[str] = []
    for name in names:
        stem = Path(name).stem
        normalized = _normalize_candidate_title(stem)
        if not normalized or _looks_like_generated_stem(normalized):
            continue
        candidates.append(normalized)

    if not candidates:
        return ""

    prioritized = [title for title in candidates if re.search(r"[\u4e00-\u9fff]", title)]
    pool = prioritized or candidates
    counts = Counter(pool)
    best = sorted(counts.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))[0][0]
    return best


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


def _resolve_managed_file(path: str, name: str) -> tuple[Path, Path]:
    folder_dir = resolve_dir(path).resolve()
    source = (folder_dir / name).resolve()
    if not source.is_relative_to(folder_dir) or not source.exists() or not source.is_file():
        raise FileNotFoundError("file not found")
    if source.suffix.lower() not in ALLOWED_SUFFIX:
        raise ValueError("file type not allowed")
    return folder_dir, source


def _dedupe_entry_name(dest_dir: Path, desired_name: str) -> str:
    candidate = desired_name
    stem = Path(desired_name).stem
    suffix = Path(desired_name).suffix
    i = 1
    while (dest_dir / candidate).exists():
        candidate = f"{stem}_{i}{suffix}"
        i += 1
    return candidate


def rename_file_in_folder(path: str, old_name: str, new_name: str) -> dict[str, Any]:
    folder_dir, source = _resolve_managed_file(path, old_name)
    old_ext = source.suffix.lower()
    target_name = new_name if Path(new_name).suffix else f"{new_name}{old_ext}"
    if Path(target_name).suffix.lower() not in ALLOWED_SUFFIX:
        raise ValueError("invalid extension")

    target = (folder_dir / target_name).resolve()
    if not target.is_relative_to(folder_dir):
        raise ValueError("invalid destination")
    if target.exists() and target != source:
        raise FileExistsError("target filename exists")
    if target == source:
        return {"old": old_name, "new": source.name, "path": path}

    remove_variants_for_source(source)
    source.rename(target)
    rename_in_order(path, old_name, target.name)
    return {"old": old_name, "new": target.name, "path": path}


def move_file_between_folders(src_path: str, name: str, dest_path: str) -> dict[str, Any]:
    src_dir, source = _resolve_managed_file(src_path, name)
    dest_dir = resolve_dir(dest_path).resolve()
    if dest_dir == src_dir:
        raise ValueError("cannot move to same folder")
    if dest_dir.exists() and not dest_dir.is_dir():
        raise ValueError("destination is not a folder")

    dest_dir.mkdir(parents=True, exist_ok=True)
    target_name = _dedupe_entry_name(dest_dir, source.name)
    target = (dest_dir / target_name).resolve()
    remove_variants_for_source(source)
    shutil.move(str(source), str(target))
    remove_in_order(src_path, source.name)
    append_in_order(dest_path, target.name)
    return {"src": source.name, "dst": target.name, "src_path": src_path, "dest": dest_path}


def copy_file_between_folders(src_path: str, name: str, dest_path: str) -> dict[str, Any]:
    _src_dir, source = _resolve_managed_file(src_path, name)
    dest_dir = resolve_dir(dest_path).resolve()
    if dest_dir.exists() and not dest_dir.is_dir():
        raise ValueError("destination is not a folder")

    dest_dir.mkdir(parents=True, exist_ok=True)
    target_name = _dedupe_entry_name(dest_dir, source.name)
    target = (dest_dir / target_name).resolve()
    shutil.copy2(str(source), str(target))
    append_in_order(dest_path, target.name)
    return {"src": source.name, "dst": target.name, "src_path": src_path, "dest": dest_path}


def copy_folder(path: str, dest_path: str = "", before_name: str | None = None) -> dict[str, Any]:
    src_dir = resolve_dir(path).resolve()
    if not src_dir.exists():
        raise FileNotFoundError("folder not found")
    if not src_dir.is_dir():
        raise ValueError("not a folder")

    if dest_path:
        dest_dir = resolve_dir(dest_path).resolve()
    else:
        dest_dir = _current_root()
    if not dest_dir.exists():
        raise FileNotFoundError("dest folder not found")
    if not dest_dir.is_dir():
        raise ValueError("dest is not a folder")
    if dest_dir == src_dir or dest_dir.is_relative_to(src_dir):
        raise ValueError("cannot copy folder into itself")

    target_name = _dedupe_entry_name(dest_dir, src_dir.name)
    new_path = f"{dest_path}/{target_name}" if dest_path else target_name
    target_dir = resolve_dir(new_path).resolve()
    shutil.copytree(str(src_dir), str(target_dir))
    reorder_subfolder(dest_dir, target_dir.name, before_name=before_name)
    return {"path": path, "dest": dest_path, "new_path": new_path}


def list_tokens_with_counts() -> List[dict[str, Any]]:
    root = _current_root()
    if not root.exists():
        return []
    out = []
    for p in sorted(root.iterdir()):
        if (
            not p.is_dir()
            or p.is_symlink()
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
        out.append({"token": p.name, "count": count, "title": infer_token_title(p.name)})
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


def _load_subfolder_order_from_fs(d: Path) -> list[str]:
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


def load_subfolder_order(d: Path) -> list[str]:
    backend = metadata_backend()
    rel_path = ""
    try:
        rel_path = d.resolve().relative_to(_current_root()).as_posix()
    except Exception:
        rel_path = ""
    if backend == "sqlite" and rel_path:
        record = load_folder_order_record(_owner_id(), rel_path)
        if record is not None:
            return record
        order = _load_subfolder_order_from_fs(d)
        if order:
            save_folder_order_record(_owner_id(), rel_path, order)
        return order

    order = _load_subfolder_order_from_fs(d)
    if backend == "dual" and rel_path:
        save_folder_order_record(_owner_id(), rel_path, order)
    return order


def save_subfolder_order(d: Path, order: list[str]):
    p = d / FOLDER_ORDER_FILE
    p.write_text(json.dumps(order, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        rel_path = d.resolve().relative_to(_current_root()).as_posix()
    except Exception:
        rel_path = ""
    if rel_path and metadata_backend() in {"dual", "sqlite"}:
        save_folder_order_record(_owner_id(), rel_path, order)


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


def rename_subfolder_in_order(parent_dir: Path, old_name: str, new_name: str):
    prev = load_subfolder_order(parent_dir)
    if not prev:
        return
    next_order: list[str] = []
    seen = set()
    for name in prev:
        mapped = new_name if name == old_name else name
        if mapped and mapped not in seen:
            next_order.append(mapped)
            seen.add(mapped)
    save_subfolder_order(parent_dir, next_order)


def build_tree(root: Path | None = None, rel: str = "") -> list[dict[str, Any]]:
    root = root or _current_root()
    if not root.exists():
        return []
    items = []
    for p in ordered_child_dirs(root):
        child_rel = f"{rel}/{p.name}" if rel else p.name
        children = build_tree(p, child_rel)
        has_images = _count_images(p) > 0
        is_album = has_images and not children
        slug = get_or_create_slug(child_rel)
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


def search_manager_items(query: str, path: str = "", scope: str = "subtree", limit: int = 200) -> list[dict[str, Any]]:
    needle = str(query or "").strip().lower()
    if not needle:
        return []

    scope_value = "global" if scope == "global" else "subtree"
    base_path = str(path or "").strip().strip("/")
    results: list[dict[str, Any]] = []

    def within_scope(node_path: str) -> bool:
        if scope_value == "global" or not base_path:
            return True
        return node_path == base_path or node_path.startswith(f"{base_path}/")

    def walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes or []:
            node_path = str(node.get("path") or "")
            node_name = str(node.get("name") or "")
            node_slug = str(node.get("slug") or "")
            if within_scope(node_path):
                searchable_path = node_path.lower()
                searchable_name = node_name.lower()
                if node_slug and (needle in searchable_name or needle in searchable_path):
                    results.append(
                        {
                            "kind": "folder",
                            "name": node_name,
                            "path": node_path,
                            "token": node_slug,
                            "image_count": int(node.get("image_count") or 0),
                        }
                    )
                    if len(results) >= limit:
                        return

                if node_slug:
                    for file_name in list_images_by_path(node_path):
                        full_path = f"{node_path}/{file_name}" if node_path else file_name
                        if needle in file_name.lower() or needle in full_path.lower():
                            results.append(
                                {
                                    "kind": "file",
                                    "name": file_name,
                                    "path": node_path,
                                    "full_path": full_path,
                                    "token": node_slug,
                                }
                            )
                            if len(results) >= limit:
                                return

            children = node.get("children")
            if isinstance(children, list) and children:
                walk(children)
                if len(results) >= limit:
                    return

    walk(build_tree())
    return results


def _trash_root() -> Path:
    root = (_current_root() / ARCHIVE_DIRNAME / "trash").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _make_trash_target(kind: str, display_name: str) -> tuple[Path, str]:
    safe_name = re.sub(r"[^\w\-.\u4e00-\u9fff]+", "-", (display_name or "item").strip())
    safe_name = safe_name.strip("-_") or kind
    target_dir = (_trash_root() / kind / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}-{safe_name}").resolve()
    rel_path = target_dir.relative_to(_current_root()).as_posix()
    return target_dir, rel_path


def move_file_to_trash(token: str, name: str) -> dict[str, Any]:
    d = token_dir(token).resolve()
    src = (d / name).resolve()
    root = _current_root()
    original_rel_path = src.relative_to(root).as_posix()
    target_dir, trash_rel_path = _make_trash_target("files", name)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = (target_dir / src.name).resolve()
    remove_variants_for_source(src)
    shutil.move(str(src), str(target))
    remove_in_order(token, name)
    return create_trash_entry(
        _owner_id(),
        item_type="file",
        original_rel_path=original_rel_path,
        trash_rel_path=target.relative_to(root).as_posix(),
        display_name=name,
        meta={"token": token},
    )


def move_folder_to_trash(path: str) -> dict[str, Any]:
    src = resolve_dir(path).resolve()
    root = _current_root()
    original_rel_path = src.relative_to(root).as_posix()
    target, trash_rel_path = _make_trash_target("folders", Path(path).name)
    old_parent_dir = src.parent
    shutil.move(str(src), str(target))
    remove_subfolder_from_order(old_parent_dir, src.name)
    remove_slug_paths(path)
    return create_trash_entry(
        _owner_id(),
        item_type="folder",
        original_rel_path=original_rel_path,
        trash_rel_path=trash_rel_path,
        display_name=Path(path).name,
        meta={"path": path},
    )


def list_trash_items() -> list[dict[str, Any]]:
    return list_trash_entries(_owner_id())


def restore_trash_item(item_id: int) -> dict[str, Any]:
    entry = get_trash_entry(_owner_id(), item_id)
    if entry is None:
        raise FileNotFoundError("trash item not found")

    root = _current_root()
    src = (root / str(entry.get("trash_rel_path") or "")).resolve()
    dst = (root / str(entry.get("original_rel_path") or "")).resolve()
    if not src.exists():
        delete_trash_entry(_owner_id(), item_id)
        raise FileNotFoundError("trash payload missing")
    if dst.exists():
        raise FileExistsError("restore target already exists")

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))

    if str(entry.get("item_type") or "") == "file":
        parent_rel = dst.parent.relative_to(root).as_posix()
        parent_token = get_or_create_slug(parent_rel)
        append_in_order(parent_token, dst.name)
    else:
        if dst.parent == root:
            parent_dir = root
        else:
            parent_dir = dst.parent.resolve()
        reorder_subfolder(parent_dir, dst.name)

    delete_trash_entry(_owner_id(), item_id)
    return {"ok": True, "id": item_id, "restored": dst.relative_to(root).as_posix()}


def delete_trashed_item(item_id: int) -> dict[str, Any]:
    entry = get_trash_entry(_owner_id(), item_id)
    if entry is None:
        raise FileNotFoundError("trash item not found")

    root = _current_root()
    target = (root / str(entry.get("trash_rel_path") or "")).resolve()
    if target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)
            parent = target.parent
            if parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
    delete_trash_entry(_owner_id(), item_id)
    return {"ok": True, "id": item_id, "deleted": True}


# ── 访问统计 ──

def _load_stats() -> dict[str, Any]:
    stats_file = _stats_file()
    if stats_file.exists():
        try:
            return json.loads(stats_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_stats(data: dict[str, Any]):
    stats_file = _stats_file()
    stats_file.parent.mkdir(parents=True, exist_ok=True)
    stats_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


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


def _normalize_ip(ip: str) -> str:
    try:
        return str(ipaddress.ip_address((ip or "").strip()))
    except ValueError:
        return (ip or "").strip() or "unknown"


def _is_explicitly_excluded_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _analytics_excluded_nets)


def _looks_like_manage_source(value: str) -> bool:
    text = (value or "").strip().lower()
    if not text:
        return False
    return "/manage" in text or "/login" in text


def _visit_filter_reason(ip: str, *, referer: str = "", origin: str = "", has_admin_session: bool = False) -> str:
    normalized_ip = _normalize_ip(ip)
    if _is_local_ip(normalized_ip):
        return "local_ip"
    if _is_explicitly_excluded_ip(normalized_ip):
        return "excluded_ip"
    if has_admin_session:
        return "admin_session"
    if _looks_like_manage_source(referer):
        return "admin_referer"
    if _looks_like_manage_source(origin):
        return "admin_origin"
    return ""


def _get_ip2region_searcher():
    global _ip2region_searcher, _ip2region_unavailable

    # Fast path: already initialised or permanently unavailable
    if _ip2region_searcher is not None:
        return _ip2region_searcher
    if _ip2region_unavailable:
        return None

    # Guard: must have a valid DB path
    if not _IP2REGION_DB_PATH or not _IP2REGION_DB_PATH.exists():
        _ip2region_unavailable = True
        return None

    # Thread-safe lazy init
    with _ip2region_lock:
        if _ip2region_searcher is not None:
            return _ip2region_searcher
        if _ip2region_unavailable:
            return None
        try:
            from ip2region import searcher as ip2r_searcher
            from ip2region import util as ip2r_util

            buf = ip2r_util.load_content_from_file(str(_IP2REGION_DB_PATH))
            header = ip2r_util.load_header_from_file(str(_IP2REGION_DB_PATH))
            ver = ip2r_util.version_from_header(header)
            _ip2region_searcher = ip2r_searcher.Searcher(ver, str(_IP2REGION_DB_PATH), None, buf)
            return _ip2region_searcher
        except Exception:
            import logging
            logging.getLogger(__name__).warning("ip2region init failed", exc_info=True)
            _ip2region_unavailable = True
            return None
    if _ip2region_searcher is not None:
        return _ip2region_searcher
    # Guard: must have a valid DB path
    if not _IP2REGION_DB_PATH or not _IP2REGION_DB_PATH.exists():
        _ip2region_unavailable = True
        return None
    # Thread-safe lazy init
    with _ip2region_lock:
        if _ip2region_unavailable:
            return None
        if _ip2region_searcher is not None:
            return _ip2region_searcher
        try:
            from ip2region import searcher as ip2r_searcher
            from ip2region import util as ip2r_util

            buf = ip2r_util.load_content_from_file(str(_IP2REGION_DB_PATH))
            header = ip2r_util.load_header_from_file(str(_IP2REGION_DB_PATH))
            ver = ip2r_util.version_from_header(header)
            _ip2region_searcher = ip2r_searcher.Searcher(ver, str(_IP2REGION_DB_PATH), None, buf)
            return _ip2region_searcher
        except Exception:
            import logging
            logging.getLogger(__name__).warning(
                "ip2region init failed for path=%s", _IP2REGION_DB_PATH, exc_info=True
            )
            _ip2region_unavailable = True
            return None


def _geoip_lookup(ip: str) -> tuple[str, str, str]:
    if not REGION_TRACE_ENABLED:
        return "", "", ""
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
    visits_file = _visits_file()
    visits_old_file = _visits_old_file()
    try:
        if visits_file.exists() and visits_file.stat().st_size >= _VISITS_MAX_BYTES:
            try:
                if visits_old_file.exists():
                    visits_old_file.unlink()
            except Exception:
                pass
            try:
                visits_file.replace(visits_old_file)
            except Exception:
                pass
    except Exception:
        pass


def _append_visit_record(token: str, ip: str, ua: str, time_z: str) -> tuple[str, str, str]:
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
    visits_file = _visits_file()
    with _visits_lock:
        _rotate_visits_if_needed()
        visits_file.parent.mkdir(parents=True, exist_ok=True)
        with open(visits_file, "a", encoding="utf-8") as f:
            f.write(line)
    return city, region, country


def record_visit(
    token: str,
    ip: str,
    ua: str = "",
    stats_key: str = "",
    album_key: str = "",
    *,
    referer: str = "",
    origin: str = "",
    has_admin_session: bool = False,
):
    """Record a visit. stats_key is used for _stats.json (defaults to token)."""
    normalized_ip = _normalize_ip(ip)
    if _visit_filter_reason(normalized_ip, referer=referer, origin=origin, has_admin_session=has_admin_session):
        return
    sk = stats_key or token
    ak = album_key or sk
    now_utc = _utc_now_z()
    now_bjt = _now_bjt()
    city = ""
    region = ""
    country = ""
    if ANALYTICS_WRITE_LEGACY:
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
        if ANALYTICS_WRITE_LEGACY:
            city, region, country = _append_visit_record(token=token, ip=normalized_ip, ua=ua or "", time_z=now_bjt)
        else:
            city, region, country = _geoip_lookup(normalized_ip)
    except Exception:
        # Never break album rendering on analytics failures.
        pass
    if ANALYTICS_WRITE_SQLITE:
        try:
            record_sqlite_visit(
                owner_id=_owner_id(),
                album_key=ak,
                stats_key=sk,
                ip_norm=normalized_ip,
                ua=ua or "",
                city=city,
                region=region,
                country=country,
                visited_at=now_bjt,
            )
        except Exception:
            pass


def get_all_stats() -> dict[str, Any]:
    if ANALYTICS_READ_SQLITE:
        try:
            data = get_stats_rollups(_owner_id())
            if data or not _legacy_has_visit_data():
                return data
        except Exception:
            pass
    return _load_stats()


def _legacy_has_visit_data() -> bool:
    if _stats_file().exists():
        return True
    if _visits_old_file().exists():
        return True
    if _visits_file().exists():
        return True
    return False


def _iter_visit_records_legacy():
    yield from _iter_jsonl(_visits_old_file())
    yield from _iter_jsonl(_visits_file())


def backfill_sqlite_from_legacy() -> dict[str, int]:
    owner_id = _owner_id()
    events_backfilled = 0
    for path in (_visits_old_file(), _visits_file()):
        if not path.exists():
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, start=1):
                    try:
                        rec = json.loads((line or "").strip())
                    except Exception:
                        continue
                    if not isinstance(rec, dict):
                        continue
                    token = str(rec.get("token") or "")
                    if not token:
                        continue
                    ip = _normalize_ip(str(rec.get("ip") or ""))
                    visited_at = str(rec.get("time") or "") or _now_bjt()
                    result = record_sqlite_visit(
                        owner_id=owner_id,
                        album_key=token,
                        stats_key=token,
                        ip_norm=ip,
                        ua=str(rec.get("ua") or ""),
                        city=str(rec.get("city") or ""),
                        region=str(rec.get("region") or ""),
                        country=str(rec.get("country") or ""),
                        visited_at=visited_at,
                        filter_reason="",
                        source_key=f"legacy:{path.name}:{line_no}",
                    )
                    if result.get("event_inserted"):
                        events_backfilled += 1
        except Exception:
            continue

    stats_seeded = 0
    for stats_key, entry in _load_stats().items():
        if not isinstance(entry, dict):
            continue
        seed_stats_rollup(
            owner_id=owner_id,
            stats_key=str(stats_key or ""),
            views=int(entry.get("views", 0) or 0),
            first_visit=str(entry.get("first_visit") or ""),
            last_visit=str(entry.get("last_visit") or ""),
        )
        stats_seeded += 1

    return {"stats_seeded": stats_seeded, "events_backfilled": events_backfilled}


def compare_analytics_sources(limit: int = 20) -> dict[str, Any]:
    legacy_stats = _load_stats()
    sqlite_stats = get_stats_rollups(_owner_id())
    legacy_analytics = _get_analytics_from_records(_iter_visit_records_legacy(), limit=limit, include_local=False)
    sqlite_analytics = _get_analytics_from_records(iter_sqlite_visit_events(_owner_id()), limit=limit, include_local=False)
    return {
        "legacy": {
            "stats_keys": len(legacy_stats),
            "total_visits": int(sum(int(entry.get("views", 0) or 0) for entry in legacy_stats.values() if isinstance(entry, dict))),
            "today_visit_count": int(legacy_analytics.get("today_visit_count") or 0),
            "unique_ip_count": int(legacy_analytics.get("unique_ip_count") or 0),
        },
        "sqlite": {
            "stats_keys": len(sqlite_stats),
            "total_visits": int(sum(int(entry.get("views", 0) or 0) for entry in sqlite_stats.values())),
            "today_visit_count": int(sqlite_analytics.get("today_visit_count") or 0),
            "unique_ip_count": int(sqlite_analytics.get("unique_ip_count") or 0),
        },
        "top_legacy_tokens": sorted(
            ((k, int(v.get("views", 0) or 0)) for k, v in legacy_stats.items() if isinstance(v, dict)),
            key=lambda item: (-item[1], item[0]),
        )[:limit],
        "top_sqlite_tokens": sorted(
            ((k, int(v.get("views", 0) or 0)) for k, v in sqlite_stats.items()),
            key=lambda item: (-item[1], item[0]),
        )[:limit],
    }


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
    if ANALYTICS_READ_SQLITE:
        try:
            rows = list(iter_sqlite_visit_events(_owner_id()))
            if rows or not _legacy_has_visit_data():
                yield from rows
                return
        except Exception:
            pass
    # Old file first, then current file. Both are capped by rotation (10MB each).
    yield from _iter_visit_records_legacy()


def _normalize_city(city: str, ip: str) -> str:
    c = (city or "").strip()
    if not c or c == "本地":
        return "未知"
    return c


def get_daily_views(days: int = 7) -> list[dict[str, int | str]]:
    days = max(1, int(days or 7))
    today = datetime.now(_BJT).date()
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
            dt = dt.replace(tzinfo=_BJT)
        day = dt.astimezone(_BJT).date()
        if start_day <= day <= today:
            key = day.isoformat()
            day_counts[key] = int(day_counts.get(key, 0)) + 1

    result: list[dict[str, int | str]] = []
    for i in range(days):
        day = start_day + timedelta(days=i)
        key = day.isoformat()
        result.append({"date": key, "views": int(day_counts.get(key, 0))})
    return result


def _get_analytics_from_records(records, *, limit: int = 1000, include_local: bool = False) -> dict[str, Any]:
    limit = max(1, min(int(limit or 1000), 5000))

    recent = deque(maxlen=limit)
    by_city: Counter[str] = Counter()
    by_date: Counter[str] = Counter()
    by_token: Counter[str] = Counter()
    ip_token: dict[str, Counter[str]] = defaultdict(Counter)
    ip_city: dict[str, Counter[str]] = defaultdict(Counter)
    unique_ips: set[str] = set()
    total = 0
    mapped_local = 0

    for rec in records:
        token = str(rec.get("token") or "")
        ip = str(rec.get("ip") or "")
        total += 1
        recent.append(rec)
        raw_city = str(rec.get("city") or "")
        city = _normalize_city(raw_city, ip)
        if city == "未知" and raw_city == "本地":
            mapped_local += 1
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
        "local_visit_filtered": 0,
        "include_local": True,
        "local_visit_mapped": int(mapped_local),
    }


def get_analytics(limit: int = 1000, include_local: bool = False) -> dict[str, Any]:
    return _get_analytics_from_records(iter_visit_records(), limit=limit, include_local=include_local)


def _load_slugs_from_fs() -> dict[str, Any]:
    slugs_file = _slugs_file()
    if slugs_file.exists():
        try:
            return json.loads(slugs_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"slug_to_path": {}, "path_to_slug": {}}


def _load_slugs() -> dict[str, Any]:
    backend = metadata_backend()
    if backend == "sqlite":
        data = load_slugs_snapshot()
        if data.get("slug_to_path"):
            return data
        fs_data = _load_slugs_from_fs()
        if fs_data.get("slug_to_path"):
            save_slugs_snapshot(fs_data)
        return fs_data

    data = _load_slugs_from_fs()
    if backend == "dual":
        save_slugs_snapshot(data)
    return data


def _save_slugs(data: dict[str, Any]):
    slugs_file = _slugs_file()
    slugs_file.parent.mkdir(parents=True, exist_ok=True)
    slugs_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if metadata_backend() in {"dual", "sqlite"}:
        save_slugs_snapshot(data)


def _slug_entry_owner(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("owner") or LEGACY_USER_ID)
    return LEGACY_USER_ID


def _slug_entry_path(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("path") or "")
    return str(entry or "")


def _make_slug(path: str, owner_id: str | None = None) -> str:
    owner = owner_id or get_current_user_id()
    seed = f"{_SLUG_SALT}|{path}" if owner == LEGACY_USER_ID else f"{_SLUG_SALT}|{owner}|{path}"
    h = hashlib.sha256(seed.encode()).hexdigest()[:8]
    return f"a-{h}"


def get_or_create_slug(path: str) -> str:
    owner = get_current_user_id()
    key = slug_owner_key(path, owner)
    with _slugs_lock:
        data = _load_slugs()
        existing = data["path_to_slug"].get(key)
        if existing:
            _ensure_symlink(existing, path, owner)
            return existing
        slug = _make_slug(path, owner)
        data["slug_to_path"][slug] = path if owner == LEGACY_USER_ID else {"owner": owner, "path": path}
        data["path_to_slug"][key] = slug
        _save_slugs(data)
        _ensure_symlink(slug, path, owner)
        return slug


def _ensure_symlink(slug: str, path: str, owner_id: str | None = None):
    owner = owner_id or get_current_user_id()
    root = get_root_for_user_id(owner)
    root.mkdir(parents=True, exist_ok=True)
    link = root / slug
    target = root / path
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
    entry = data["slug_to_path"].get(slug)
    if entry is None:
        return None
    owner = _slug_entry_owner(entry)
    apply_user_scope(owner)
    return _slug_entry_path(entry)


def get_all_slugs() -> dict[str, Any]:
    return _load_slugs()


def rename_slug_paths(old_path: str, new_path: str):
    old_path = old_path.strip().strip("/")
    new_path = new_path.strip().strip("/")
    if not old_path or not new_path or old_path == new_path:
        return

    with _slugs_lock:
        data = _load_slugs()
        slug_to_path = data.get("slug_to_path", {})
        path_to_slug = data.get("path_to_slug", {})
        owner = get_current_user_id()
        owner_key_old = slug_owner_key(old_path, owner)

        updates: list[tuple[str, str, str]] = []
        prefix = f"{old_path}/"
        for slug, entry in list(slug_to_path.items()):
            if _slug_entry_owner(entry) != owner:
                continue
            path = _slug_entry_path(entry)
            if path == old_path:
                replacement = new_path
            elif path.startswith(prefix):
                replacement = f"{new_path}/{path[len(prefix):]}"
            else:
                continue
            updates.append((slug, path, replacement))

        if not updates:
            return

        for slug, old_item_path, new_item_path in updates:
            slug_to_path[slug] = new_item_path if owner == LEGACY_USER_ID else {"owner": owner, "path": new_item_path}
            path_to_slug.pop(slug_owner_key(old_item_path, owner), None)
            path_to_slug[slug_owner_key(new_item_path, owner)] = slug

        data["slug_to_path"] = slug_to_path
        data["path_to_slug"] = path_to_slug
        _save_slugs(data)

        for slug, _old_item_path, new_item_path in updates:
            root = get_root_for_user_id(owner)
            link = root / slug
            if link.is_symlink():
                try:
                    link.unlink()
                except OSError:
                    pass
            _ensure_symlink(slug, new_item_path, owner)


def remove_slug_paths(path_prefix: str):
    path_prefix = path_prefix.strip().strip("/")
    if not path_prefix:
        return

    with _slugs_lock:
        data = _load_slugs()
        slug_to_path = data.get("slug_to_path", {})
        path_to_slug = data.get("path_to_slug", {})
        owner = get_current_user_id()
        prefix = f"{path_prefix}/"
        to_remove = []
        for slug, entry in list(slug_to_path.items()):
            if _slug_entry_owner(entry) != owner:
                continue
            path = _slug_entry_path(entry)
            if path == path_prefix or path.startswith(prefix):
                to_remove.append((slug, path))

        if not to_remove:
            return

        for slug, path in to_remove:
            slug_to_path.pop(slug, None)
            path_to_slug.pop(slug_owner_key(path, owner), None)
            link = get_root_for_user_id(owner) / slug
            if link.is_symlink():
                try:
                    link.unlink()
                except OSError:
                    pass

        data["slug_to_path"] = slug_to_path
        data["path_to_slug"] = path_to_slug
        _save_slugs(data)
