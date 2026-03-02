def _png_bytes() -> bytes:
    # Minimal signature + padding; app only sniffs the first bytes.
    return b"\x89PNG\r\n\x1a\n" + (b"\x00" * 128)


def test_upload_requires_key(client):
    r = client.post(
        "/api/upload/testtoken",
        files={"file": ("x.png", _png_bytes(), "image/png")},
    )
    assert r.status_code in (401, 403)


def test_upload_with_key_succeeds(client, upload_secret, base_dir):
    r = client.post(
        "/api/upload/testtoken",
        headers={"X-Upload-Key": upload_secret},
        files={"file": ("x.png", _png_bytes(), "image/png")},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["token"] == "testtoken"
    assert data["file"].endswith(".png")
    assert (base_dir / "testtoken" / data["file"]).exists()

