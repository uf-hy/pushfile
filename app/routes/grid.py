import io
import zipfile
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, UploadFile, HTTPException, Header, Form
from fastapi.responses import Response

from app.auth import auth_header_key, safe_path, resolve_dir, sniff_image_type
from app.config import MAX_BYTES, MAX_MB
from app.grid_processor import process_nine_grid, generate_grid_preview
from app.storage import append_in_order

router = APIRouter(prefix="/api/grid", tags=["grid"])


def _safe_filename(filename: str) -> str:
    safe = re.sub(r"[^\w\-_.]", "", Path(filename).stem)
    return safe[:50] or "image"


def _safe_folder_name(name: str) -> str:
    safe = re.sub(r"[^\w\-]", "_", name)
    return safe[:50] or "folder"


def _validate_grid_params(line_width: int, gap: int, img_width: int, img_height: int) -> None:
    if line_width < 1 or line_width > 20:
        raise HTTPException(status_code=400, detail="线宽必须在 1-20 之间")
    if gap < 0 or gap > 100:
        raise HTTPException(status_code=400, detail="间距必须在 0-100 之间")
    if gap > 0:
        min_size = gap * 4 + 3
        if img_width < min_size or img_height < min_size:
            raise HTTPException(status_code=400, detail=f"图片尺寸太小，无法使用 {gap}px 间距")
    if img_width * img_height > 20000 * 20000:
        raise HTTPException(status_code=400, detail="图片尺寸过大（最大 20000x20000 像素）")


@router.post("/preview")
async def grid_preview(
    file: UploadFile = File(...),
    line_width: int = Form(default=2),
    gap: int = Form(default=0),
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"文件太大（最大 {MAX_MB}MB）")

    from PIL import Image, UnidentifiedImageError
    from PIL.Image import DecompressionBombError

    try:
        img = Image.open(io.BytesIO(content))
        img.load()
        _validate_grid_params(line_width, gap, img.width, img.height)
    except (UnidentifiedImageError, DecompressionBombError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"无效的图片文件: {str(e)}")

    preview_bytes = generate_grid_preview(
        source_image=img,
        line_width=line_width,
        gap=gap,
        output_format="JPEG",
        quality=95,
    )

    safe_name = _safe_filename(file.filename or "preview")
    return Response(
        content=preview_bytes,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="{safe_name}.jpg"'},
    )


@router.post("/split")
async def grid_split(
    file: UploadFile = File(...),
    line_width: int = Form(default=2),
    gap: int = Form(default=0),
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"文件太大（最大 {MAX_MB}MB)")

    from PIL import Image, UnidentifiedImageError
    from PIL.Image import DecompressionBombError

    try:
        img = Image.open(io.BytesIO(content))
        img.load()
        _validate_grid_params(line_width, gap, img.width, img.height)
    except (UnidentifiedImageError, DecompressionBombError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"无效的图片文件: {str(e)}")

    preview_bytes, tile_bytes_list = process_nine_grid(
        source_image=img,
        draw_grid=True,
        line_width=line_width,
        gap=gap,
        output_format="JPEG",
        quality=95,
    )

    safe_stem = _safe_filename(file.filename or "image")
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{safe_stem}_preview.jpg", preview_bytes)
        for i, tile_bytes in enumerate(tile_bytes_list, 1):
            zf.writestr(f"{safe_stem}_{i}.jpg", tile_bytes)

    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_stem}_grid.zip"'},
    )


@router.post("/save")
async def grid_save(
    file: UploadFile = File(...),
    destination: str = Form(default="九宫格"),
    folder_name: Optional[str] = Form(default=None),
    line_width: int = Form(default=2),
    gap: int = Form(default=0),
    x_upload_key: str | None = Header(default=None),
):
    auth_header_key(x_upload_key)
    head = await file.read(64)
    if sniff_image_type(head) is None:
        raise HTTPException(status_code=400, detail="只支持图片文件")

    remaining = await file.read()
    full_bytes = head + remaining
    if len(full_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"文件太大（最大 {MAX_MB}MB）")

    from PIL import Image, UnidentifiedImageError
    from PIL.Image import DecompressionBombError

    try:
        img = Image.open(io.BytesIO(full_bytes))
        img.load()
        _validate_grid_params(line_width, gap, img.width, img.height)
    except (UnidentifiedImageError, DecompressionBombError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"无效的图片文件: {str(e)}")

    preview_bytes, tile_bytes_list = process_nine_grid(
        source_image=img,
        draw_grid=True,
        line_width=line_width,
        gap=gap,
        output_format="JPEG",
        quality=95,
    )

    safe_dest = safe_path(destination)
    safe_stem = _safe_filename(file.filename or "image")
    safe_folder = _safe_folder_name(folder_name or safe_stem)
    target_path = f"{safe_dest}/{safe_folder}" if safe_dest else safe_folder
    target_dir = resolve_dir(target_path)
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_files: list[str] = []
    for i, tile_bytes in enumerate(tile_bytes_list, 1):
        filename = f"{safe_stem}_{i}.jpg"
        (target_dir / filename).write_bytes(tile_bytes)
        saved_files.append(filename)
        append_in_order(target_path, filename)

    preview_name = f"{safe_stem}_preview.jpg"
    (target_dir / preview_name).write_bytes(preview_bytes)
    saved_files.insert(0, preview_name)
    append_in_order(target_path, preview_name)

    return {
        "ok": True,
        "destination": target_path,
        "files": saved_files,
        "count": len(saved_files),
    }
