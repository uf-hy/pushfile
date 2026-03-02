import hashlib
import logging
import os
import threading
import time
import zipfile
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from fastapi import APIRouter, File, UploadFile, HTTPException, Header, Form
from fastapi.responses import JSONResponse
from app.auth import safe_token, safe_path, auth_header_key, token_dir, resolve_dir, sniff_image_type
from app.image_variants import ensure_all_variants_best_effort
from app.storage import append_in_order, ALLOWED_SUFFIX
from app.config import MAX_BYTES, MAX_MB

router = APIRouter(prefix="/api/upload", tags=["upload"])
logger = logging.getLogger(__name__)

_VARIANT_WORKERS = max(1, int(os.environ.get("VARIANT_WORKERS", "2")))
_VARIANT_QUEUE_SIZE = max(1, int(os.environ.get("VARIANT_QUEUE_SIZE", "512")))
_IMPORT_MAX_FILES = max(1, int(os.environ.get("IMPORT_MAX_FILES", "500")))
_IMPORT_MAX_TOTAL_BYTES = max(MAX_BYTES, int(os.environ.get("IMPORT_MAX_TOTAL_BYTES", str(MAX_BYTES * 200))))
_variant_pool = ThreadPoolExecutor(max_workers=_VARIANT_WORKERS, thread_name_prefix="variant")
_variant_queue_slots = threading.BoundedSemaphore(_VARIANT_QUEUE_SIZE)


def _queue_variant(path: Path) -> None:
    if not _variant_queue_slots.acquire(blocking=False):
        logger.warning("variant queue full, skip generation: %s", path)
        return

    def _run(target: Path) -> None:
        try:
            ensure_all_variants_best_effort(target)
        finally:
            _variant_queue_slots.release()

    _variant_pool.submit(_run, path)


def _generate_variants_async(paths: list[Path]) -> None:
    if not paths:
        return
    for p in paths:
        _queue_variant(p)


def _safe_destination(destination: str | None) -> str:
    raw = (destination or "").strip().strip("/")
    if not raw:
        return ""
    return safe_path(raw)


def _safe_folder_name(folder_name: str | None) -> str | None:
    raw = (folder_name or "").strip().strip("/")
    if not raw:
        return None
    if "/" in raw or "\\" in raw:
        raise HTTPException(status_code=400, detail="folder name must be a single segment")
    return safe_path(raw)


def _rewrite_rel_dir(rel_dir: str, folder_name: str | None) -> str | None:
    rel_dir = rel_dir.strip("/")
    if not rel_dir:
        return folder_name
    parts = [p for p in rel_dir.split("/") if p]
    if not parts:
        return folder_name
    if folder_name:
        rest = parts[1:] if len(parts) > 1 else []
        out = [folder_name, *rest]
        return "/".join(out)
    return "/".join(parts)


def _resolve_target_dir(destination: str, rel_dir: str | None) -> Path:
    parts = [p for p in [destination, rel_dir or ""] if p]
    combined = "/".join(parts)
    safe_combined = safe_path(combined)
    return resolve_dir(safe_combined)


@router.post("/zip-import")
async def api_zip_import(
    file: UploadFile = File(...),
    destination: str | None = Form(default=None),
    folder_name: str | None = Form(default=None),
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

    target_destination = _safe_destination(destination)
    target_folder_name = _safe_folder_name(folder_name)

    try:
        imported = 0
        imported_total_bytes = 0
        imported_files: list[Path] = []
        skipped_hidden = 0
        skipped_ext = 0
        skipped_root = 0
        skipped_path = 0
        skipped_oversize = 0
        try:
            with zipfile.ZipFile(tmp_path, "r") as zf:
                for info in zf.infolist():
                    if imported >= _IMPORT_MAX_FILES:
                        break
                    if info.is_dir():
                        continue
                    name = info.filename.replace("\\", "/").strip()
                    if not name:
                        skipped_path += 1
                        continue
                    if name.startswith("__MACOSX") or "/." in name or name.startswith("."):
                        skipped_hidden += 1
                        continue
                    ext = Path(name).suffix.lower()
                    if ext not in ALLOWED_SUFFIX:
                        skipped_ext += 1
                        continue
                    if imported_total_bytes + max(0, int(info.file_size)) > _IMPORT_MAX_TOTAL_BYTES:
                        skipped_oversize += 1
                        continue
                    rel_dir = str(Path(name).parent).replace("\\", "/")
                    rewritten_rel_dir = _rewrite_rel_dir(rel_dir if rel_dir != "." else "", target_folder_name)
                    if not rewritten_rel_dir:
                        skipped_root += 1
                        continue
                    target_dir = _resolve_target_dir(target_destination, rewritten_rel_dir)
                    target_root = target_dir.resolve()
                    target_root.mkdir(parents=True, exist_ok=True)
                    target_file = (target_root / Path(name).name).resolve()
                    if not target_file.is_relative_to(target_root):
                        skipped_path += 1
                        continue
                    size = 0
                    with zf.open(info) as src, target_file.open("wb") as dst:
                        while True:
                            chunk = src.read(1024 * 1024)
                            if not chunk:
                                break
                            size += len(chunk)
                            if size > MAX_BYTES:
                                dst.close()
                                target_file.unlink(missing_ok=True)
                                skipped_oversize += 1
                                break
                            dst.write(chunk)
                    if size <= MAX_BYTES:
                        imported += 1
                        imported_total_bytes += size
                        imported_files.append(target_file)
        except zipfile.BadZipFile as e:
            logger.warning("zip import failed: invalid zip '%s'", file.filename)
            raise HTTPException(status_code=400, detail="invalid zip file") from e

        if imported == 0:
            logger.warning(
                "zip import produced 0 files: file=%s hidden=%s ext=%s root=%s path=%s oversize=%s",
                file.filename,
                skipped_hidden,
                skipped_ext,
                skipped_root,
                skipped_path,
                skipped_oversize,
            )
            raise HTTPException(
                status_code=400,
                detail="no valid images found in zip (need jpg/jpeg/png/gif/webp inside folders)",
            )
        logger.info(
            "zip import success: file=%s imported=%s hidden=%s ext=%s root=%s path=%s oversize=%s",
            file.filename,
            imported,
            skipped_hidden,
            skipped_ext,
            skipped_root,
            skipped_path,
            skipped_oversize,
        )
        _generate_variants_async(imported_files)
        return {"ok": True, "imported": imported}
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/folder-import")
async def api_folder_import(
    files: list[UploadFile] = File(...),
    paths: list[str] = Form(...),
    destination: str | None = Form(default=None),
    folder_name: str | None = Form(default=None),
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    if len(files) != len(paths):
        raise HTTPException(status_code=400, detail="files/paths count mismatch")
    if len(files) > _IMPORT_MAX_FILES:
        raise HTTPException(status_code=413, detail=f"too many files (max {_IMPORT_MAX_FILES})")

    target_destination = _safe_destination(destination)
    target_folder_name = _safe_folder_name(folder_name)

    imported = 0
    imported_total_bytes = 0
    imported_files: list[Path] = []
    skipped_invalid = 0
    skipped_hidden = 0
    skipped_root = 0
    skipped_type = 0
    skipped_oversize = 0

    for uploaded, raw_path in zip(files, paths):
        normalized = raw_path.replace("\\", "/").strip().lstrip("/")
        if not normalized or normalized.endswith("/"):
            skipped_invalid += 1
            continue
        if normalized.startswith("__MACOSX") or "/." in normalized or normalized.startswith("."):
            skipped_hidden += 1
            continue

        rel_dir = str(Path(normalized).parent).replace("\\", "/")
        rewritten_rel_dir = _rewrite_rel_dir(rel_dir if rel_dir != "." else "", target_folder_name)
        if not rewritten_rel_dir:
            skipped_root += 1
            continue

        try:
            target_dir = _resolve_target_dir(target_destination, rewritten_rel_dir)
        except HTTPException:
            skipped_invalid += 1
            continue

        target_root = target_dir.resolve()
        target_root.mkdir(parents=True, exist_ok=True)
        file_name = Path(normalized).name
        if not file_name:
            skipped_invalid += 1
            continue

        head = await uploaded.read(64)
        ext = sniff_image_type(head)
        if ext is None:
            skipped_type += 1
            continue

        suffix = Path(file_name).suffix.lower()
        if suffix not in ALLOWED_SUFFIX:
            file_name = f"{Path(file_name).stem}{ext}"
        target = (target_root / file_name).resolve()
        if not target.is_relative_to(target_root):
            skipped_invalid += 1
            continue

        total = len(head)
        accepted = True
        with target.open("wb") as out:
            out.write(head)
            while True:
                chunk = await uploaded.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES or imported_total_bytes + total > _IMPORT_MAX_TOTAL_BYTES:
                    out.close()
                    target.unlink(missing_ok=True)
                    skipped_oversize += 1
                    accepted = False
                    break
                out.write(chunk)
        if accepted and total <= MAX_BYTES:
            imported += 1
            imported_total_bytes += total
            imported_files.append(target)

    if imported == 0:
        logger.warning(
            "folder import produced 0 files: invalid=%s hidden=%s root=%s type=%s oversize=%s",
            skipped_invalid,
            skipped_hidden,
            skipped_root,
            skipped_type,
            skipped_oversize,
        )
        raise HTTPException(
            status_code=400,
            detail="no valid images found in dropped folder (need jpg/jpeg/png/gif/webp inside folders)",
        )

    logger.info(
        "folder import success: imported=%s invalid=%s hidden=%s root=%s type=%s oversize=%s",
        imported,
        skipped_invalid,
        skipped_hidden,
        skipped_root,
        skipped_type,
        skipped_oversize,
    )
    _generate_variants_async(imported_files)
    return {"ok": True, "imported": imported}


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
    _generate_variants_async([out])
    return JSONResponse(
        {"ok": True, "token": token, "file": out.name, "album": f"/d/{token}"}
    )
