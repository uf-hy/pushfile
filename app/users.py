import hashlib
import os
import secrets
import sqlite3
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import cast, TypedDict

from app.config import BASE_DIR, UPLOAD_SECRET

LEGACY_USER_ID = "legacy-admin"
USERS_ROOT = (BASE_DIR / "_users").resolve()
SYSTEM_DIR = (BASE_DIR / "_system").resolve()
DB_PATH = (SYSTEM_DIR / "users.sqlite3").resolve()
SESSION_DAYS = 30


class UserRecord(TypedDict):
    id: str
    username: str
    password_hash: str
    root_path: str
    role: str
    is_active: bool
    is_legacy: bool
    created_at: str


_current_user: ContextVar[UserRecord | None] = ContextVar("current_user", default=None)
_current_root: ContextVar[Path] = ContextVar("current_root", default=BASE_DIR)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    SYSTEM_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _user_root(user_id: str) -> Path:
    if user_id == LEGACY_USER_ID:
        return BASE_DIR
    return (USERS_ROOT / user_id / "files").resolve()


def _normalize_user(row: sqlite3.Row | None) -> UserRecord | None:
    if row is None:
        return None
    root_path = row["root_path"] or ""
    root = BASE_DIR if not root_path else Path(root_path).resolve()
    return cast(UserRecord, cast(object, {
        "id": row["id"],
        "username": row["username"],
        "password_hash": row["password_hash"],
        "root_path": str(root),
        "role": row["role"] or "manager",
        "is_active": bool(row["is_active"]),
        "is_legacy": bool(row["is_legacy"]),
        "created_at": row["created_at"],
    }))


def _hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, digest_hex = stored.split("$", 2)
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    candidate = _hash_password(password, salt=bytes.fromhex(salt_hex))
    return secrets.compare_digest(candidate, stored)


def init_user_store() -> None:
    conn = _connect()
    try:
        _ = conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                root_path TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                is_active INTEGER NOT NULL DEFAULT 1,
                is_legacy INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            """
        )
        conn.commit()
        cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "role" not in cols:
            _ = conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'manager'")
            conn.commit()
    finally:
        conn.close()
    ensure_legacy_user()


def ensure_legacy_user() -> None:
    conn = _connect()
    try:
        row = conn.execute("SELECT id FROM users WHERE id = ?", (LEGACY_USER_ID,)).fetchone()
        password_hash = _hash_password(UPLOAD_SECRET)
        if row:
            _ = conn.execute(
                "UPDATE users SET username = ?, password_hash = ?, root_path = ?, role = 'admin', is_active = 1, is_legacy = 1 WHERE id = ?",
                ("admin", password_hash, str(BASE_DIR), LEGACY_USER_ID),
            )
        else:
            _ = conn.execute(
                "INSERT INTO users (id, username, password_hash, root_path, role, is_active, is_legacy, created_at) VALUES (?, ?, ?, ?, 'admin', 1, 1, ?)",
                (LEGACY_USER_ID, "admin", password_hash, str(BASE_DIR), _utc_now()),
            )
        conn.commit()
    finally:
        conn.close()


def list_users() -> list[UserRecord]:
    conn = _connect()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY is_legacy DESC, username ASC").fetchall()
        return [user for row in rows if (user := _normalize_user(row)) is not None]
    finally:
        conn.close()


def get_user_by_username(username: str) -> UserRecord | None:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return _normalize_user(row)
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> UserRecord | None:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _normalize_user(row)
    finally:
        conn.close()


def authenticate(username: str, password: str) -> UserRecord | None:
    user = get_user_by_username(username)
    if not user or not user.get("is_active"):
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


def authenticate_credential(credential: str) -> UserRecord | None:
    raw = (credential or "").strip()
    if not raw:
        return None
    if raw == UPLOAD_SECRET:
        return get_user_by_id(LEGACY_USER_ID)
    if ":" not in raw:
        return authenticate("admin", raw)
    username, password = raw.split(":", 1)
    username = username.strip() or "admin"
    return authenticate(username, password)


def create_session(user_id: str) -> str:
    session_id = secrets.token_urlsafe(32)
    created_at = datetime.now(timezone.utc)
    expires_at = created_at + timedelta(days=SESSION_DAYS)
    conn = _connect()
    try:
        _ = conn.execute(
            "INSERT INTO sessions (session_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (session_id, user_id, created_at.isoformat(), expires_at.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()
    return session_id


def delete_session(session_id: str) -> None:
    conn = _connect()
    try:
        _ = conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()


def get_user_by_session(session_id: str | None) -> UserRecord | None:
    if not session_id:
        return None
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.session_id = ? AND s.expires_at > ?",
            (session_id, _utc_now()),
        ).fetchone()
        return _normalize_user(row)
    finally:
        conn.close()


def create_user(username: str, password: str) -> UserRecord:
    username = (username or "").strip()
    if not username:
        raise ValueError("username required")
    if len(username) < 3 or len(username) > 32:
        raise ValueError("username length must be 3-32")
    if not username.replace("_", "").replace("-", "").isalnum():
        raise ValueError("username must be letters, numbers, underscore or hyphen")
    if len(password or "") < 8:
        raise ValueError("password length must be at least 8")
    if get_user_by_username(username):
        raise ValueError("username already exists")
    user_id = f"u-{secrets.token_hex(6)}"
    root = _user_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    user = cast(UserRecord, cast(object, {
        "id": user_id,
        "username": username,
        "password_hash": _hash_password(password),
        "root_path": str(root),
        "role": "manager",
        "is_active": True,
        "is_legacy": False,
        "created_at": _utc_now(),
    }))
    conn = _connect()
    try:
        _ = conn.execute(
            "INSERT INTO users (id, username, password_hash, root_path, role, is_active, is_legacy, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?)",
            (user_id, username, user["password_hash"], user["root_path"], user["role"], user["created_at"]),
        )
        conn.commit()
    finally:
        conn.close()
    return get_user_by_id(user_id) or user


def set_current_user(user: UserRecord | None) -> None:
    if not user:
        _current_user.set(None)
        _current_root.set(BASE_DIR)
        return
    _current_user.set(user)
    _current_root.set(Path(user["root_path"]).resolve())


def get_current_user() -> UserRecord | None:
    return _current_user.get()


def get_current_user_id() -> str:
    user = _current_user.get()
    return user["id"] if user else LEGACY_USER_ID


def get_current_root() -> Path:
    return _current_root.get()


def get_root_for_user_id(user_id: str) -> Path:
    user = get_user_by_id(user_id)
    if user:
        return Path(user["root_path"]).resolve()
    return _user_root(user_id)


def apply_user_scope(user_id: str) -> UserRecord | None:
    user = get_user_by_id(user_id)
    set_current_user(user)
    return user


def slug_owner_key(path: str, owner_id: str | None = None) -> str:
    owner = owner_id or get_current_user_id()
    if owner == LEGACY_USER_ID:
        return path
    return f"{owner}:{path}"


def is_admin_user(user: UserRecord | None) -> bool:
    return bool(user and user.get("role") == "admin")
