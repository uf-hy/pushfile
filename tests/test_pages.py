def test_home_page_ok(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers.get("Referrer-Policy") == "no-referrer"


def test_robots_txt_content(client):
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert r.text == "User-agent: *\nDisallow: /d/\nDisallow: /f/\n"
    assert r.headers.get("Referrer-Policy") == "no-referrer"


def test_d_nonexistent_token_404(client):
    r = client.get("/d/doesnotexist")
    assert r.status_code == 404
    assert r.headers.get("Referrer-Policy") == "no-referrer"

