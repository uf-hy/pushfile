import sys
import types
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient


def _write_min_frontend(frontend_dir: Path) -> None:
    (frontend_dir / "admin").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "album").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "landing").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "admin" / "index.html").write_text("<html>admin</html>", encoding="utf-8")
    (frontend_dir / "album" / "index.html").write_text("<html>album {{ token }}</html>", encoding="utf-8")
    (frontend_dir / "landing" / "index.html").write_text("<html>landing</html>", encoding="utf-8")


@pytest.fixture()
def analytics_app_ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    base_dir = tmp_path / "uploads"
    base_dir.mkdir(parents=True, exist_ok=True)
    frontend_dir = tmp_path / "frontend"
    _write_min_frontend(frontend_dir)

    monkeypatch.setenv("UPLOAD_SECRET", "analytics-secret")
    monkeypatch.setenv("UPLOAD_BASE", str(base_dir))
    monkeypatch.setenv("FRONTEND_DIR", str(frontend_dir))
    monkeypatch.setenv("ANALYTICS_WRITE_LEGACY", "1")
    monkeypatch.setenv("ANALYTICS_WRITE_SQLITE", "1")
    monkeypatch.setenv("ANALYTICS_READ_SQLITE", "0")

    for name in list(sys.modules.keys()):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    import importlib

    main = importlib.import_module("app.main")
    analytics_store = importlib.import_module("app.analytics_store")
    return {"app": main.app, "base_dir": base_dir, "analytics_store": analytics_store}


def _import_modules_with_flags(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    write_legacy: str = "1",
    write_sqlite: str = "1",
    read_sqlite: str = "0",
 ) -> dict[str, Any]:
    base_dir = tmp_path / "uploads"
    base_dir.mkdir(parents=True, exist_ok=True)
    frontend_dir = tmp_path / "frontend"
    _write_min_frontend(frontend_dir)

    monkeypatch.setenv("UPLOAD_SECRET", "analytics-secret")
    monkeypatch.setenv("UPLOAD_BASE", str(base_dir))
    monkeypatch.setenv("FRONTEND_DIR", str(frontend_dir))
    monkeypatch.setenv("ANALYTICS_WRITE_LEGACY", write_legacy)
    monkeypatch.setenv("ANALYTICS_WRITE_SQLITE", write_sqlite)
    monkeypatch.setenv("ANALYTICS_READ_SQLITE", read_sqlite)

    for name in list(sys.modules.keys()):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    import importlib

    main = importlib.import_module("app.main")
    return {
        "base_dir": base_dir,
        "app": main.app,
        "storage": importlib.import_module("app.storage"),
        "analytics_store": importlib.import_module("app.analytics_store"),
    }


def test_analytics_store_init_creates_db_and_schema(analytics_app_ctx):
    analytics_store = analytics_app_ctx["analytics_store"]
    db_path = analytics_store.analytics_db_path()
    assert db_path.exists()

    conn = analytics_store._connect()
    try:
        schema_version = conn.execute(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'"
        ).fetchone()
        assert schema_version is not None
        assert int(schema_version["value"]) == analytics_store.SCHEMA_VERSION

        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert {"schema_meta", "visit_events", "unique_visitors"}.issubset(tables)
    finally:
        conn.close()


def test_analytics_store_init_is_idempotent(analytics_app_ctx):
    analytics_store = analytics_app_ctx["analytics_store"]
    analytics_store.init_analytics_store()
    analytics_store.init_analytics_store()

    conn = analytics_store._connect()
    try:
        rows = conn.execute(
            "SELECT key, value FROM schema_meta WHERE key IN ('schema_version', 'initialized_at') ORDER BY key ASC"
        ).fetchall()
        assert len(rows) == 2
    finally:
        conn.close()


def test_main_import_survives_analytics_init_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    base_dir = tmp_path / "uploads"
    base_dir.mkdir(parents=True, exist_ok=True)
    frontend_dir = tmp_path / "frontend"
    _write_min_frontend(frontend_dir)

    monkeypatch.setenv("UPLOAD_SECRET", "analytics-secret")
    monkeypatch.setenv("UPLOAD_BASE", str(base_dir))
    monkeypatch.setenv("FRONTEND_DIR", str(frontend_dir))

    for name in list(sys.modules.keys()):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    fake_module = types.ModuleType("app.analytics_store")

    def _boom() -> None:
        raise RuntimeError("boom")

    setattr(fake_module, "init_analytics_store", _boom)
    setattr(fake_module, "record_sqlite_visit", lambda **_kwargs: None)
    setattr(fake_module, "get_stats_rollups", lambda *_args, **_kwargs: {})
    setattr(fake_module, "iter_sqlite_visit_events", lambda *_args, **_kwargs: iter(()))
    setattr(fake_module, "seed_stats_rollup", lambda **_kwargs: None)
    monkeypatch.setitem(sys.modules, "app.analytics_store", fake_module)

    import importlib

    main = importlib.import_module("app.main")
    assert main.app is not None
    assert (base_dir / "_system" / "users.sqlite3").exists()
    assert (base_dir / "_system" / "metadata.sqlite3").exists()


def test_dual_write_records_events_and_unique_visitors(analytics_app_ctx):
    analytics_store = analytics_app_ctx["analytics_store"]

    import importlib

    storage = importlib.import_module("app.storage")
    storage.record_visit("album1", "203.0.113.5", "pytest", album_key="folder-a")
    storage.record_visit("album1", "203.0.113.5", "pytest", album_key="folder-a")
    storage.record_visit("album2", "203.0.113.5", "pytest", album_key="folder-b")

    conn = analytics_store._connect()
    try:
        event_count = conn.execute("SELECT COUNT(*) AS c FROM visit_events").fetchone()["c"]
        unique_count = conn.execute("SELECT COUNT(*) AS c FROM unique_visitors").fetchone()["c"]
        assert event_count == 3
        assert unique_count == 2
    finally:
        conn.close()


def test_sqlite_write_failure_does_not_break_legacy_stats(analytics_app_ctx, monkeypatch: pytest.MonkeyPatch):
    base_dir = analytics_app_ctx["base_dir"]

    import importlib

    storage = importlib.import_module("app.storage")
    analytics_store = importlib.import_module("app.analytics_store")

    def _boom(**_kwargs):
        raise RuntimeError("sqlite down")

    monkeypatch.setattr(analytics_store, "record_sqlite_visit", _boom)
    monkeypatch.setattr(storage, "record_sqlite_visit", _boom)

    storage.record_visit("album1", "203.0.113.10", "pytest", album_key="folder-a")

    stats = storage.get_all_stats()
    assert stats["album1"]["views"] == 1
    visits = list(storage.iter_visit_records())
    assert len(visits) == 1


def test_backfill_is_idempotent_and_seeds_rollups(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    legacy_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="0", read_sqlite="0")
    legacy_storage = cast(Any, legacy_ctx["storage"])
    legacy_storage.record_visit("album1", "203.0.113.5", "pytest")
    legacy_storage.record_visit("album1", "203.0.113.5", "pytest")
    legacy_storage.record_visit("album2", "203.0.113.8", "pytest")

    sqlite_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="1", read_sqlite="0")
    storage = cast(Any, sqlite_ctx["storage"])
    analytics_store = cast(Any, sqlite_ctx["analytics_store"])

    first = storage.backfill_sqlite_from_legacy()
    second = storage.backfill_sqlite_from_legacy()
    assert first["events_backfilled"] == 3
    assert second["events_backfilled"] == 0

    conn = analytics_store._connect()
    try:
        rollups = analytics_store.get_stats_rollups("legacy-admin")
        assert rollups["album1"]["views"] == 2
        assert rollups["album2"]["views"] == 1
        assert conn.execute("SELECT COUNT(*) AS c FROM visit_events").fetchone()["c"] == 3
    finally:
        conn.close()


def test_sqlite_read_can_replace_legacy_and_fallback_when_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    legacy_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="0", read_sqlite="0")
    legacy_storage = cast(Any, legacy_ctx["storage"])
    legacy_storage.record_visit("album1", "203.0.113.5", "pytest")
    legacy_storage.record_visit("album1", "203.0.113.6", "pytest")

    sqlite_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="1", read_sqlite="0")
    storage = cast(Any, sqlite_ctx["storage"])
    _ = storage.backfill_sqlite_from_legacy()

    read_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="1", read_sqlite="1")
    read_storage = cast(Any, read_ctx["storage"])
    sqlite_stats = read_storage.get_all_stats()
    sqlite_analytics = read_storage.get_analytics()
    assert sqlite_stats["album1"]["views"] == 2
    assert sqlite_analytics["total_visit_count"] == 2

    empty_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="0", read_sqlite="1")
    empty_storage = cast(Any, empty_ctx["storage"])
    fallback_stats = empty_storage.get_all_stats()
    assert fallback_stats["album1"]["views"] == 2


def test_sqlite_read_supports_dashboard_and_analytics_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    legacy_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="0", read_sqlite="0")
    legacy_storage = cast(Any, legacy_ctx["storage"])
    legacy_storage.record_visit("album1", "203.0.113.5", "pytest")
    legacy_storage.record_visit("album1", "203.0.113.6", "pytest")

    sqlite_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="1", read_sqlite="1")
    storage = cast(Any, sqlite_ctx["storage"])
    _ = storage.backfill_sqlite_from_legacy()

    with TestClient(sqlite_ctx["app"]) as client:
        dashboard = client.get("/api/stats/dashboard", headers={"X-Upload-Key": "analytics-secret"})
        assert dashboard.status_code == 200
        dash_data = dashboard.json()
        assert dash_data["ok"] is True
        assert dash_data["total_visits"] == 2
        assert dash_data["recent_activities"][0]["name"] == "album1"

        analytics = client.get("/api/analytics", headers={"X-Upload-Key": "analytics-secret"})
        assert analytics.status_code == 200
        analytics_data = analytics.json()
        assert analytics_data["total_visit_count"] == 2
        assert analytics_data["unique_ip_count"] == 2


def test_compare_analytics_sources_reports_legacy_and_sqlite(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    legacy_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="0", read_sqlite="0")
    legacy_storage = cast(Any, legacy_ctx["storage"])
    legacy_storage.record_visit("album1", "203.0.113.5", "pytest")
    legacy_storage.record_visit("album2", "203.0.113.6", "pytest")

    sqlite_ctx = _import_modules_with_flags(tmp_path, monkeypatch, write_sqlite="1", read_sqlite="0")
    storage = cast(Any, sqlite_ctx["storage"])
    _ = storage.backfill_sqlite_from_legacy()
    compare = storage.compare_analytics_sources()
    assert compare["legacy"]["total_visits"] == 2
    assert compare["sqlite"]["total_visits"] == 2
    assert compare["legacy"]["stats_keys"] == 2
    assert compare["sqlite"]["stats_keys"] == 2
