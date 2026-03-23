import io
import zipfile


def _png_bytes() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + (b"\x00" * 128)


def test_folder_search_supports_subtree_and_global(client, upload_secret, base_dir):
    (base_dir / "alpha").mkdir(parents=True, exist_ok=True)
    (base_dir / "alpha" / "nested").mkdir(parents=True, exist_ok=True)
    (base_dir / "beta").mkdir(parents=True, exist_ok=True)
    (base_dir / "alpha" / "hero.png").write_bytes(_png_bytes())
    (base_dir / "alpha" / "nested" / "detail.png").write_bytes(_png_bytes())
    (base_dir / "beta" / "global-hit.png").write_bytes(_png_bytes())

    subtree = client.get(
        f"/api/folders/search?key={upload_secret}&query=detail&path=alpha&scope=subtree"
    )
    assert subtree.status_code == 200
    subtree_data = subtree.json()
    assert subtree_data["ok"] is True
    assert any(item["kind"] == "file" and item["full_path"] == "alpha/nested/detail.png" for item in subtree_data["results"])
    assert all(not str(item.get("path") or "").startswith("beta") for item in subtree_data["results"])

    global_resp = client.get(
        f"/api/folders/search?key={upload_secret}&query=global-hit&scope=global"
    )
    assert global_resp.status_code == 200
    global_data = global_resp.json()
    assert any(item["kind"] == "file" and item["full_path"] == "beta/global-hit.png" for item in global_data["results"])


def test_manage_export_returns_original_zip_for_multiple_files(client, upload_secret, base_dir):
    album_dir = base_dir / "album"
    album_dir.mkdir(parents=True, exist_ok=True)
    (album_dir / "a.png").write_bytes(_png_bytes())
    (album_dir / "b.png").write_bytes(_png_bytes())

    resp = client.post(
        "/api/manage/album/export",
        headers={"X-Upload-Key": upload_secret},
        json={"names": ["a.png", "b.png"], "mode": "original"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(resp.content), "r") as zf:
        assert sorted(zf.namelist()) == ["a.png", "b.png"]


def test_manage_export_returns_attachment_for_single_file(client, upload_secret, base_dir):
    album_dir = base_dir / "album"
    album_dir.mkdir(parents=True, exist_ok=True)
    (album_dir / "single.png").write_bytes(_png_bytes())

    resp = client.post(
        "/api/manage/album/export",
        headers={"X-Upload-Key": upload_secret},
        json={"names": ["single.png"], "mode": "deliverable"},
    )
    assert resp.status_code == 200
    assert "attachment" in (resp.headers.get("content-disposition") or "")
