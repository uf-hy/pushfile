def test_analytics_rejects_query_key(client, upload_secret):
    r = client.get(f"/api/analytics?key={upload_secret}")
    assert r.status_code in (401, 403)


def test_analytics_accepts_header_key(client, upload_secret):
    r = client.get("/api/analytics", headers={"X-Upload-Key": upload_secret})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
