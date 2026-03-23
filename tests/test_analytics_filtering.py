import sys
from pathlib import Path


def _write_min_frontend(frontend_dir: Path) -> None:
    (frontend_dir / "admin").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "album").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "landing").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "admin" / "index.html").write_text("<html>admin</html>", encoding="utf-8")
    (frontend_dir / "album" / "index.html").write_text("<html>album {{ token }}</html>", encoding="utf-8")
    (frontend_dir / "landing" / "index.html").write_text("<html>landing</html>", encoding="utf-8")


def _import_storage(tmp_path: Path, monkeypatch, *, region_enabled: str = "1", excluded_nets: str = ""):
    base_dir = tmp_path / "uploads"
    base_dir.mkdir(parents=True, exist_ok=True)
    frontend_dir = tmp_path / "frontend"
    _write_min_frontend(frontend_dir)

    monkeypatch.setenv("UPLOAD_SECRET", "analytics-secret")
    monkeypatch.setenv("UPLOAD_BASE", str(base_dir))
    monkeypatch.setenv("FRONTEND_DIR", str(frontend_dir))
    monkeypatch.setenv("REGION_TRACE_ENABLED", region_enabled)
    monkeypatch.setenv("ANALYTICS_EXCLUDED_NETS", excluded_nets)

    for name in list(sys.modules.keys()):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    import importlib

    storage = importlib.import_module("app.storage")
    return base_dir, storage


def test_record_visit_skips_local_and_admin_origin(tmp_path: Path, monkeypatch):
    base_dir, storage = _import_storage(tmp_path, monkeypatch)

    storage.record_visit("album1", "127.0.0.1", "pytest")
    storage.record_visit(
        "album1",
        "203.0.113.5",
        "pytest",
        referer="https://phototest.xaihub.de/manage/album",
        has_admin_session=True,
    )

    assert not (base_dir / "_stats.json").exists()
    assert not (base_dir / "_visits.jsonl").exists()


def test_record_visit_accepts_public_ip_and_respects_excluded_nets(tmp_path: Path, monkeypatch):
    base_dir, storage = _import_storage(tmp_path, monkeypatch, excluded_nets="198.51.100.0/24")

    storage.record_visit("album1", "203.0.113.5", "pytest")
    storage.record_visit("album1", "198.51.100.12", "pytest")

    stats = storage.get_all_stats()
    assert stats["album1"]["views"] == 1

    visits = list(storage.iter_visit_records())
    assert len(visits) == 1
    assert visits[0]["ip"] == "203.0.113.5"


def test_geoip_lookup_returns_unknown_when_region_trace_disabled(tmp_path: Path, monkeypatch):
    _base_dir, storage = _import_storage(tmp_path, monkeypatch, region_enabled="0")
    assert storage._geoip_lookup("8.8.8.8") == ("", "", "")
