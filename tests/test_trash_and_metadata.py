import json
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _write_min_frontend(frontend_dir: Path) -> None:
    (frontend_dir / "admin").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "album").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "admin" / "index.html").write_text("<html>admin</html>", encoding="utf-8")
    (frontend_dir / "album" / "index.html").write_text("<html>album {{ token }}</html>", encoding="utf-8")


@pytest.fixture()
def sqlite_app_ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    base_dir = tmp_path / "uploads"
    base_dir.mkdir(parents=True, exist_ok=True)
    frontend_dir = tmp_path / "frontend"
    _write_min_frontend(frontend_dir)

    monkeypatch.setenv("UPLOAD_SECRET", "sqlite-secret")
    monkeypatch.setenv("UPLOAD_BASE", str(base_dir))
    monkeypatch.setenv("FRONTEND_DIR", str(frontend_dir))
    monkeypatch.setenv("APP_METADATA_BACKEND", "sqlite")

    for name in list(sys.modules.keys()):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    import importlib

    main = importlib.import_module("app.main")
    return {"app": main.app, "base_dir": base_dir, "secret": "sqlite-secret"}


@pytest.fixture()
def sqlite_client(sqlite_app_ctx: dict[str, Any]):
    with TestClient(sqlite_app_ctx["app"]) as c:
        yield c


def test_file_delete_moves_to_trash_and_can_restore(client, upload_secret, base_dir):
    album_dir = base_dir / "album1"
    album_dir.mkdir(parents=True, exist_ok=True)
    (album_dir / "cover.jpg").write_bytes(b"jpg-data")
    (album_dir / ".manifest.json").write_text(
        json.dumps({"title": "相册 1", "order": ["cover.jpg"]}, ensure_ascii=False),
        encoding="utf-8",
    )

    delete_resp = client.post(
        "/api/manage/album1/delete",
        headers={"X-Upload-Key": upload_secret},
        json={"name": "cover.jpg"},
    )
    assert delete_resp.status_code == 200
    payload = delete_resp.json()
    assert payload["ok"] is True
    assert payload["mode"] == "trash"
    assert not (album_dir / "cover.jpg").exists()

    trash_resp = client.get("/api/trash", params={"key": upload_secret})
    assert trash_resp.status_code == 200
    items = trash_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["display_name"] == "cover.jpg"

    restore_resp = client.post(
        "/api/trash/restore",
        headers={"X-Upload-Key": upload_secret},
        json={"id": items[0]["id"]},
    )
    assert restore_resp.status_code == 200
    assert (album_dir / "cover.jpg").exists()

    list_resp = client.get(f"/api/manage/album1?key={upload_secret}")
    assert list_resp.status_code == 200
    assert list_resp.json()["files"] == ["cover.jpg"]


def test_sqlite_metadata_backend_reads_title_and_order_without_manifest(sqlite_client, sqlite_app_ctx):
    base_dir = sqlite_app_ctx["base_dir"]
    secret = sqlite_app_ctx["secret"]
    album_dir = base_dir / "album1"
    album_dir.mkdir(parents=True, exist_ok=True)
    (album_dir / "a.jpg").write_bytes(b"a")
    (album_dir / "b.jpg").write_bytes(b"b")

    meta_resp = sqlite_client.post(
        "/api/manage/album1/meta",
        headers={"X-Upload-Key": secret},
        json={"title": "SQLite 相册"},
    )
    assert meta_resp.status_code == 200

    order_resp = sqlite_client.post(
        "/api/manage/album1/order",
        headers={"X-Upload-Key": secret},
        json={"names": ["b.jpg", "a.jpg"]},
    )
    assert order_resp.status_code == 200

    manifest_path = album_dir / ".manifest.json"
    assert manifest_path.exists()
    manifest_path.unlink()

    list_resp = sqlite_client.get(f"/api/manage/album1?key={secret}")
    assert list_resp.status_code == 200
    assert list_resp.json()["title"] == "SQLite 相册"
    assert list_resp.json()["files"] == ["b.jpg", "a.jpg"]
    assert (base_dir / "_system" / "metadata.sqlite3").exists()
