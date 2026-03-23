import hashlib
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import (
    ANALYTICS_WRITE_SQLITE,
    ANALYTICS_SQLITE_SYNCHRONOUS,
    ANALYTICS_SQLITE_TIMEOUT_MS,
    BASE_DIR,
)

SYSTEM_DIR = (BASE_DIR / "_system").resolve()
DB_PATH = (SYSTEM_DIR / "analytics.sqlite3").resolve()
SCHEMA_VERSION = 2
_VISITOR_SALT = (os.environ.get("ANALYTICS_VISITOR_SALT") or "photo-analytics-2026").strip() or "photo-analytics-2026"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def analytics_db_path() -> Path:
    return DB_PATH


def analytics_write_enabled() -> bool:
    return ANALYTICS_WRITE_SQLITE


def _connect() -> sqlite3.Connection:
    SYSTEM_DIR.mkdir(parents=True, exist_ok=True)
    timeout_s = max(0.1, ANALYTICS_SQLITE_TIMEOUT_MS / 1000)
    conn = sqlite3.connect(DB_PATH, timeout=timeout_s)
    conn.row_factory = sqlite3.Row
    _ = conn.execute("PRAGMA foreign_keys = ON")
    _ = conn.execute(f"PRAGMA busy_timeout = {int(ANALYTICS_SQLITE_TIMEOUT_MS)}")
    _ = conn.execute("PRAGMA journal_mode = WAL")
    _ = conn.execute(f"PRAGMA synchronous = {ANALYTICS_SQLITE_SYNCHRONOUS}")
    return conn


def init_analytics_store() -> None:
    conn = _connect()
    try:
        _ = conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS visit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_key TEXT NOT NULL UNIQUE,
                owner_id TEXT NOT NULL,
                album_key TEXT NOT NULL,
                stats_key TEXT NOT NULL,
                ip_norm TEXT NOT NULL,
                visitor_hash TEXT NOT NULL,
                ua TEXT NOT NULL DEFAULT '',
                city TEXT NOT NULL DEFAULT '',
                region TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                visited_at TEXT NOT NULL,
                is_filtered INTEGER NOT NULL DEFAULT 0,
                filter_reason TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_visit_events_owner_album_time
                ON visit_events(owner_id, album_key, visited_at DESC);
            CREATE INDEX IF NOT EXISTS idx_visit_events_stats_key_time
                ON visit_events(stats_key, visited_at DESC);
            CREATE INDEX IF NOT EXISTS idx_visit_events_filtered_time
                ON visit_events(is_filtered, visited_at DESC);

            CREATE TABLE IF NOT EXISTS unique_visitors (
                owner_id TEXT NOT NULL,
                album_key TEXT NOT NULL,
                visitor_hash TEXT NOT NULL,
                ip_norm TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                city TEXT NOT NULL DEFAULT '',
                region TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (owner_id, album_key, visitor_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_unique_visitors_owner_album
                ON unique_visitors(owner_id, album_key);

            CREATE TABLE IF NOT EXISTS stats_rollups (
                owner_id TEXT NOT NULL,
                stats_key TEXT NOT NULL,
                views INTEGER NOT NULL DEFAULT 0,
                first_visit TEXT,
                last_visit TEXT,
                PRIMARY KEY (owner_id, stats_key)
            );
            """
        )
        now = _utc_now()
        _ = conn.execute(
            """
            INSERT INTO schema_meta (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
            ("schema_version", str(SCHEMA_VERSION), now),
        )
        _ = conn.execute(
            """
            INSERT INTO schema_meta (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING
            """,
            ("initialized_at", now, now),
        )
        conn.commit()
        _ = conn.execute("PRAGMA optimize")
    finally:
        conn.close()


def _hash_visitor(ip_norm: str) -> str:
    raw = f"{_VISITOR_SALT}:{ip_norm}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _make_source_key(*parts: str) -> str:
    raw = "\x1f".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def record_sqlite_visit(
    *,
    owner_id: str,
    album_key: str,
    stats_key: str,
    ip_norm: str,
    ua: str,
    city: str,
    region: str,
    country: str,
    visited_at: str,
    filter_reason: str = "",
    source_key: str = "",
) -> dict[str, Any]:
    if not analytics_write_enabled():
        return {"ok": False, "reason": "disabled", "unique_created": False, "event_inserted": False}

    normalized_ip = (ip_norm or "").strip() or "unknown"
    source_key = source_key or _make_source_key(owner_id, album_key, stats_key, normalized_ip, ua or "", visited_at, filter_reason)
    visitor_hash = ""
    if normalized_ip not in {"", "unknown"}:
        visitor_hash = _hash_visitor(normalized_ip)

    conn = _connect()
    try:
        _ = conn.execute(
            """
            INSERT INTO visit_events (
                source_key, owner_id, album_key, stats_key, ip_norm, visitor_hash,
                ua, city, region, country, visited_at, is_filtered, filter_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_key) DO NOTHING
            """,
            (
                source_key,
                owner_id,
                album_key,
                stats_key,
                normalized_ip,
                visitor_hash,
                ua or "",
                city or "",
                region or "",
                country or "",
                visited_at,
                1 if filter_reason else 0,
                filter_reason,
            ),
        )
        inserted_event = bool(conn.execute("SELECT changes() AS c").fetchone()["c"])
        unique_created = False
        if visitor_hash and not filter_reason and inserted_event:
            existing_unique = conn.execute(
                "SELECT 1 FROM unique_visitors WHERE owner_id = ? AND album_key = ? AND visitor_hash = ?",
                (owner_id, album_key, visitor_hash),
            ).fetchone()
            _ = conn.execute(
                """
                INSERT INTO unique_visitors (
                    owner_id, album_key, visitor_hash, ip_norm,
                    first_seen_at, last_seen_at, city, region, country
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_id, album_key, visitor_hash) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at,
                    city = CASE WHEN excluded.city <> '' THEN excluded.city ELSE unique_visitors.city END,
                    region = CASE WHEN excluded.region <> '' THEN excluded.region ELSE unique_visitors.region END,
                    country = CASE WHEN excluded.country <> '' THEN excluded.country ELSE unique_visitors.country END
                """,
                (
                    owner_id,
                    album_key,
                    visitor_hash,
                    normalized_ip,
                    visited_at,
                    visited_at,
                    city or "",
                    region or "",
                    country or "",
                ),
            )
            unique_created = existing_unique is None
        if inserted_event:
            _ = conn.execute(
                """
                INSERT INTO stats_rollups (owner_id, stats_key, views, first_visit, last_visit)
                VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(owner_id, stats_key) DO UPDATE SET
                    views = stats_rollups.views + 1,
                    first_visit = CASE
                        WHEN stats_rollups.first_visit IS NULL OR stats_rollups.first_visit = '' THEN excluded.first_visit
                        WHEN excluded.first_visit IS NULL OR excluded.first_visit = '' THEN stats_rollups.first_visit
                        WHEN excluded.first_visit < stats_rollups.first_visit THEN excluded.first_visit
                        ELSE stats_rollups.first_visit
                    END,
                    last_visit = CASE
                        WHEN stats_rollups.last_visit IS NULL OR stats_rollups.last_visit = '' THEN excluded.last_visit
                        WHEN excluded.last_visit IS NULL OR excluded.last_visit = '' THEN stats_rollups.last_visit
                        WHEN excluded.last_visit > stats_rollups.last_visit THEN excluded.last_visit
                        ELSE stats_rollups.last_visit
                    END
                """,
                (owner_id, stats_key, visited_at, visited_at),
            )
        conn.commit()
        return {"ok": True, "source_key": source_key, "unique_created": unique_created, "event_inserted": inserted_event}
    finally:
        conn.close()


def seed_stats_rollup(*, owner_id: str, stats_key: str, views: int, first_visit: str = "", last_visit: str = "") -> None:
    conn = _connect()
    try:
        _ = conn.execute(
            """
            INSERT INTO stats_rollups (owner_id, stats_key, views, first_visit, last_visit)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, stats_key) DO UPDATE SET
                views = CASE WHEN excluded.views > stats_rollups.views THEN excluded.views ELSE stats_rollups.views END,
                first_visit = CASE
                    WHEN stats_rollups.first_visit IS NULL OR stats_rollups.first_visit = '' THEN excluded.first_visit
                    WHEN excluded.first_visit IS NULL OR excluded.first_visit = '' THEN stats_rollups.first_visit
                    WHEN excluded.first_visit < stats_rollups.first_visit THEN excluded.first_visit
                    ELSE stats_rollups.first_visit
                END,
                last_visit = CASE
                    WHEN stats_rollups.last_visit IS NULL OR stats_rollups.last_visit = '' THEN excluded.last_visit
                    WHEN excluded.last_visit IS NULL OR excluded.last_visit = '' THEN stats_rollups.last_visit
                    WHEN excluded.last_visit > stats_rollups.last_visit THEN excluded.last_visit
                    ELSE stats_rollups.last_visit
                END
            """,
            (owner_id, stats_key, int(views or 0), first_visit or "", last_visit or ""),
        )
        conn.commit()
    finally:
        conn.close()


def get_stats_rollups(owner_id: str) -> dict[str, dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT stats_key, views, first_visit, last_visit FROM stats_rollups WHERE owner_id = ? ORDER BY stats_key ASC",
            (owner_id,),
        ).fetchall()
    finally:
        conn.close()
    return {
        str(row["stats_key"]): {
            "views": int(row["views"] or 0),
            "first_visit": str(row["first_visit"] or ""),
            "last_visit": str(row["last_visit"] or ""),
        }
        for row in rows
        if str(row["stats_key"] or "")
    }


def iter_sqlite_visit_events(owner_id: str):
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT stats_key, ip_norm, city, region, country, ua, visited_at
            FROM visit_events
            WHERE owner_id = ? AND is_filtered = 0
            ORDER BY visited_at ASC, id ASC
            """,
            (owner_id,),
        ).fetchall()
    finally:
        conn.close()
    for row in rows:
        yield {
            "token": str(row["stats_key"] or ""),
            "ip": str(row["ip_norm"] or ""),
            "city": str(row["city"] or ""),
            "region": str(row["region"] or ""),
            "country": str(row["country"] or ""),
            "ua": str(row["ua"] or ""),
            "time": str(row["visited_at"] or ""),
        }
