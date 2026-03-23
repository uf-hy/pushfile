import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.users import LEGACY_USER_ID, SYSTEM_DIR, slug_owner_key

DB_PATH = (SYSTEM_DIR / "metadata.sqlite3").resolve()


def metadata_backend() -> str:
    raw = (os.environ.get("APP_METADATA_BACKEND") or "fs").strip().lower()
    if raw in {"sqlite", "dual"}:
        return raw
    return "fs"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    SYSTEM_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_metadata_store() -> None:
    conn = _connect()
    try:
        _ = conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS token_manifests (
                owner_id TEXT NOT NULL,
                token TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                order_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (owner_id, token)
            );

            CREATE TABLE IF NOT EXISTS folder_orders (
                owner_id TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                order_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (owner_id, folder_path)
            );

            CREATE TABLE IF NOT EXISTS slug_mappings (
                slug TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                path TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_slug_owner_path
                ON slug_mappings(owner_id, path);

            CREATE TABLE IF NOT EXISTS trash_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id TEXT NOT NULL,
                item_type TEXT NOT NULL,
                original_rel_path TEXT NOT NULL,
                trash_rel_path TEXT NOT NULL,
                display_name TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                meta_json TEXT NOT NULL DEFAULT '{}'
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def load_manifest_record(owner_id: str, token: str) -> dict[str, Any] | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT title, order_json FROM token_manifests WHERE owner_id = ? AND token = ?",
            (owner_id, token),
        ).fetchone()
        if row is None:
            return None
        try:
            order = json.loads(row["order_json"] or "[]")
        except Exception:
            order = []
        if not isinstance(order, list):
            order = []
        return {"title": str(row["title"] or ""), "order": [x for x in order if isinstance(x, str)]}
    finally:
        conn.close()


def save_manifest_record(owner_id: str, token: str, data: dict[str, Any]) -> None:
    conn = _connect()
    try:
        _ = conn.execute(
            """
            INSERT INTO token_manifests (owner_id, token, title, order_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, token) DO UPDATE SET
                title = excluded.title,
                order_json = excluded.order_json,
                updated_at = excluded.updated_at
            """,
            (
                owner_id,
                token,
                str(data.get("title") or ""),
                json.dumps(data.get("order") or [], ensure_ascii=False),
                _utc_now(),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def load_folder_order_record(owner_id: str, folder_path: str) -> list[str] | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT order_json FROM folder_orders WHERE owner_id = ? AND folder_path = ?",
            (owner_id, folder_path),
        ).fetchone()
        if row is None:
            return None
        try:
            order = json.loads(row["order_json"] or "[]")
        except Exception:
            order = []
        if not isinstance(order, list):
            order = []
        return [x for x in order if isinstance(x, str)]
    finally:
        conn.close()


def save_folder_order_record(owner_id: str, folder_path: str, order: list[str]) -> None:
    conn = _connect()
    try:
        _ = conn.execute(
            """
            INSERT INTO folder_orders (owner_id, folder_path, order_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(owner_id, folder_path) DO UPDATE SET
                order_json = excluded.order_json,
                updated_at = excluded.updated_at
            """,
            (owner_id, folder_path, json.dumps(order, ensure_ascii=False), _utc_now()),
        )
        conn.commit()
    finally:
        conn.close()


def load_slugs_snapshot() -> dict[str, Any]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT slug, owner_id, path FROM slug_mappings ORDER BY slug ASC"
        ).fetchall()
    finally:
        conn.close()

    slug_to_path: dict[str, Any] = {}
    path_to_slug: dict[str, str] = {}
    for row in rows:
        owner = str(row["owner_id"] or LEGACY_USER_ID)
        path = str(row["path"] or "")
        slug = str(row["slug"] or "")
        if not slug or not path:
            continue
        slug_to_path[slug] = path if owner == LEGACY_USER_ID else {"owner": owner, "path": path}
        path_to_slug[slug_owner_key(path, owner)] = slug
    return {"slug_to_path": slug_to_path, "path_to_slug": path_to_slug}


def save_slugs_snapshot(data: dict[str, Any]) -> None:
    rows: list[tuple[str, str, str, str]] = []
    slug_to_path = data.get("slug_to_path") or {}
    for slug, entry in slug_to_path.items():
        if isinstance(entry, dict):
            owner = str(entry.get("owner") or LEGACY_USER_ID)
            path = str(entry.get("path") or "")
        else:
            owner = LEGACY_USER_ID
            path = str(entry or "")
        if not slug or not path:
            continue
        rows.append((str(slug), owner, path, _utc_now()))

    conn = _connect()
    try:
        _ = conn.execute("DELETE FROM slug_mappings")
        if rows:
            _ = conn.executemany(
                "INSERT INTO slug_mappings (slug, owner_id, path, updated_at) VALUES (?, ?, ?, ?)",
                rows,
            )
        conn.commit()
    finally:
        conn.close()


def create_trash_entry(
    owner_id: str,
    *,
    item_type: str,
    original_rel_path: str,
    trash_rel_path: str,
    display_name: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    conn = _connect()
    try:
        cur = conn.execute(
            """
            INSERT INTO trash_items (owner_id, item_type, original_rel_path, trash_rel_path, display_name, deleted_at, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                owner_id,
                item_type,
                original_rel_path,
                trash_rel_path,
                display_name,
                _utc_now(),
                json.dumps(meta or {}, ensure_ascii=False),
            ),
        )
        conn.commit()
        item_id = int(cur.lastrowid or 0)
    finally:
        conn.close()
    return get_trash_entry(owner_id, item_id) or {}


def list_trash_entries(owner_id: str) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM trash_items WHERE owner_id = ? ORDER BY deleted_at DESC, id DESC",
            (owner_id,),
        ).fetchall()
    finally:
        conn.close()
    return [_normalize_trash_row(row) for row in rows]


def get_trash_entry(owner_id: str, item_id: int) -> dict[str, Any] | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM trash_items WHERE owner_id = ? AND id = ?",
            (owner_id, int(item_id)),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return _normalize_trash_row(row)


def delete_trash_entry(owner_id: str, item_id: int) -> None:
    conn = _connect()
    try:
        _ = conn.execute(
            "DELETE FROM trash_items WHERE owner_id = ? AND id = ?",
            (owner_id, int(item_id)),
        )
        conn.commit()
    finally:
        conn.close()


def _normalize_trash_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return {
        "id": int(row["id"]),
        "item_type": str(row["item_type"] or ""),
        "original_rel_path": str(row["original_rel_path"] or ""),
        "trash_rel_path": str(row["trash_rel_path"] or ""),
        "display_name": str(row["display_name"] or ""),
        "deleted_at": str(row["deleted_at"] or ""),
        "meta": meta,
    }
