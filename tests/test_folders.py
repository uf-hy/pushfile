def test_create_folder_success(client, upload_secret, base_dir):
    r = client.post(
        "/api/folders/create",
        headers={"X-Upload-Key": upload_secret},
        json={"path": "foo"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert (base_dir / "foo").is_dir()


def test_move_folder_into_child_returns_400(client, upload_secret, base_dir):
    (base_dir / "foo").mkdir(parents=True, exist_ok=True)
    (base_dir / "foo" / "bar").mkdir(parents=True, exist_ok=True)
    r = client.post(
        "/api/folders/move",
        headers={"X-Upload-Key": upload_secret},
        json={"path": "foo", "dest": "foo/bar"},
    )
    assert r.status_code == 400


def test_delete_folder_success(client, upload_secret, base_dir):
    (base_dir / "foo").mkdir(parents=True, exist_ok=True)
    r = client.post(
        "/api/folders/delete",
        headers={"X-Upload-Key": upload_secret},
        json={"path": "foo"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert not (base_dir / "foo").exists()
