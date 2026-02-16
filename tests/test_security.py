import pytest


def test_safe_name_rejects_control_characters(app_ctx):
    from fastapi import HTTPException
    from app.auth import safe_name

    with pytest.raises(HTTPException) as e:
        safe_name("bad\nname.png")
    assert e.value.status_code == 400


def test_safe_name_rejects_path_separators(app_ctx):
    from fastapi import HTTPException
    from app.auth import safe_name

    with pytest.raises(HTTPException):
        safe_name("a/b.png")
    with pytest.raises(HTTPException):
        safe_name("a\\b.png")


def test_safe_path_rejects_dotdot(app_ctx):
    from fastapi import HTTPException
    from app.auth import safe_path

    with pytest.raises(HTTPException) as e:
        safe_path("a/../b")
    assert e.value.status_code == 400


def test_rate_limiter_blocks_after_limit():
    from app.security import SlidingWindowRateLimiter

    rl = SlidingWindowRateLimiter(limit=3, window_s=60.0)
    assert rl.allow("k", now=100.0) is True
    assert rl.allow("k", now=100.0) is True
    assert rl.allow("k", now=100.0) is True
    assert rl.allow("k", now=100.0) is False

