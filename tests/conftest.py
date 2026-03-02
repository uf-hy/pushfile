import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_UPLOAD_SECRET = "test-upload-secret"


def _write_min_frontend(frontend_dir: Path) -> None:
    (frontend_dir / "admin").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "album").mkdir(parents=True, exist_ok=True)
    (frontend_dir / "admin" / "index.html").write_text("<html>admin</html>", encoding="utf-8")
    (frontend_dir / "album" / "index.html").write_text("<html>album {{ token }}</html>", encoding="utf-8")


@pytest.fixture()
def app_ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    base_dir = tmp_path / "uploads"
    base_dir.mkdir(parents=True, exist_ok=True)
    frontend_dir = tmp_path / "frontend"
    _write_min_frontend(frontend_dir)

    monkeypatch.setenv("UPLOAD_SECRET", TEST_UPLOAD_SECRET)
    monkeypatch.setenv("UPLOAD_BASE", str(base_dir))
    monkeypatch.setenv("FRONTEND_DIR", str(frontend_dir))

    for name in list(sys.modules.keys()):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    import importlib

    main = importlib.import_module("app.main")
    return {"app": main.app, "base_dir": base_dir, "secret": TEST_UPLOAD_SECRET}


@pytest.fixture()
def client(app_ctx: dict):
    with TestClient(app_ctx["app"]) as c:
        yield c


@pytest.fixture()
def base_dir(app_ctx: dict) -> Path:
    return app_ctx["base_dir"]


@pytest.fixture()
def upload_secret(app_ctx: dict) -> str:
    return app_ctx["secret"]

