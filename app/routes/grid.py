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
from app.image_variants import ensure_all_variants_best_effort

router = APIRouter(prefix="/api/grid", tags=["grid"])


def _safe_filename(filename: str) -> str:
    """生成安全的文件名"""
    stem = Path(filename).stem
    safe = re.sub(r"[^\w\-_.]", "", stem)
    return safe[:50] or "image"


def _validate_grid_params(line_width: int, gap: int, img_width: int, img_height: int) -> None:
    """校验九宫格参数"""
    if line_width < 1 or line_width > 20:
        raise HTTPException(status_code=400, detail="线宽必须在 1-20 之间")
    if gap < 0 or gap > 100:
        raise HTTPException(status_code=400, detail="间距必须在 0-100 之间")
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

    from PIL import Image, UnidentifiedImageError, DecompressionBombError

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

    return Response(
        content=preview_bytes,
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f"inline; filename={_safe_filename(file.filename or 'preview')}.jpg"
        },
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
    
    from PIL import Image
    img = Image.open(io.BytesIO(content))

    preview_bytes, tile_bytes_list = process_nine_grid(
        source_image=img,
        draw_grid=True,
        line_width=line_width,
        gap=gap,
        output_format="JPEG",
        quality=95,
    )

    zip_buffer = io.BytesIO()
    stem = Path(file.filename or "image").stem
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{stem}_preview.jpg", preview_bytes)
        for i, tile_bytes in enumerate(tile_bytes_list, 1):
            zf.writestr(f"{stem}_{i}.jpg", tile_bytes)

    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={stem}_grid.zip"},
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
    ext = sniff_image_type(head)
    if ext is None:
        raise HTTPException(status_code=400, detail="只支持图片文件")

    remaining = await file.read()
    full_bytes = head + remaining
    if len(full_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"文件太大（最大 {MAX_MB}MB）")

    from PIL import Image
    img = Image.open(io.BytesIO(full_bytes))

    preview_bytes, tile_bytes_list = process_nine_grid(
        source_image=img,
        draw_grid=True,
        line_width=line_width,
        gap=gap,
        output_format="JPEG",
        quality=95,
    )

    safe_dest = safe_path(destination)
    stem = Path(file.filename or "image").stem
    target_folder_name = folder_name or stem
    target_path = f"{safe_dest}/{target_folder_name}" if safe_dest else target_folder_name
    target_dir = resolve_dir(target_path)
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_files: list[str] = []
    all_files: list[tuple[str, bytes]] = [
        (f"{stem}_preview.jpg", preview_bytes),
    ]
    for i, tile_bytes in enumerate(tile_bytes_list, 1):
        all_files.append((f"{stem}_{i}.jpg", tile_bytes))

    for filename, content in all_files:
        file_path = target_dir / filename
        file_path.write_bytes(content)
        saved_files.append(filename)
        append_in_order(target_path, filename)

    return {
        "ok": True,
        "destination": target_path,
        "files": saved_files,
        "count": len(saved_files),
    }

