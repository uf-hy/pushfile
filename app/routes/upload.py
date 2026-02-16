import hashlib
import time
import zipfile
import tempfile
from pathlib import Path
from fastapi import APIRouter, File, UploadFile, HTTPException, Header
from fastapi.responses import JSONResponse
from app.auth import safe_token, safe_path, auth_header_key, token_dir, resolve_dir, sniff_image_type
from app.storage import append_in_order, ALLOWED_SUFFIX
from app.config import MAX_BYTES, MAX_MB, BASE_DIR

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/zip-import")
async def api_zip_import(
    file: UploadFile = File(...),
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="only .zip files allowed")

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        while True:
            chunk = await file.read(4 * 1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)

    try:
        imported = 0
        with zipfile.ZipFile(tmp_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                if name.startswith("__MACOSX") or "/." in name or name.startswith("."):
                    continue
                ext = Path(name).suffix.lower()
                if ext not in ALLOWED_SUFFIX:
                    continue
                rel_dir = str(Path(name).parent)
                if rel_dir == ".":
                    continue
                target_dir = (BASE_DIR / rel_dir).resolve()
                if not str(target_dir).startswith(str(BASE_DIR)):
                    continue
                target_dir.mkdir(parents=True, exist_ok=True)
                target_file = target_dir / Path(name).name
                with zf.open(info) as src, target_file.open("wb") as dst:
                    dst.write(src.read())
                imported += 1
        return {"ok": True, "imported": imported}
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/{token}")
async def api_upload(
    token: str, file: UploadFile = File(...), x_upload_key: str | None = Header(default=None)
):
    auth_header_key(x_upload_key)
    token = safe_token(token)
    head = await file.read(64)
    ext = sniff_image_type(head)
    if ext is None:
        raise HTTPException(status_code=400, detail="only image files allowed")
    d = token_dir(token)
    d.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256(head + str(time.time()).encode()).hexdigest()[:16]
    out = d / f"{int(time.time())}_{h}{ext}"
    total = len(head)
    with out.open("wb") as w:
        w.write(head)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BYTES:
                out.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413, detail=f"file too large (max {MAX_MB}MB)"
                )
            w.write(chunk)
    append_in_order(token, out.name)
    return JSONResponse(
        {"ok": True, "token": token, "file": out.name, "album": f"/d/{token}"}
    )
