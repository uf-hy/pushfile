"""Health check endpoint."""
import os
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    checks = {"app": "ok"}

    # Check upload directory is writable
    upload_base = Path(os.environ.get("UPLOAD_BASE", "/tmp/uploads"))
    try:
        upload_base.mkdir(parents=True, exist_ok=True)
        test_file = upload_base / ".health_check"
        test_file.write_text("ok")
        test_file.unlink()
        checks["storage"] = "ok"
    except Exception as e:
        checks["storage"] = f"error: {e}"
        return {"status": "unhealthy", "checks": checks}

    return {"status": "ok", "checks": checks}
