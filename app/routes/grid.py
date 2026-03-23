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


def _validate_grid_params(
    line_width: int,
    gap: int,
    img_width: int,
    img_height: int,
    padding: int = 0,
) -> None:
    if line_width < 0 or line_width > 40:
        raise HTTPException(status_code=400, detail="线宽必须在 0-40 之间")
    if gap < 0 or gap > 100:
        raise HTTPException(status_code=400, detail="间距必须在 0-100 之间")
    min_size = 3
    if gap > 0:
        min_size = max(min_size, gap * 2 + 3)
    if line_width > 0:
        min_size = max(min_size, line_width * 2 + 3)
    if img_width < min_size or img_height < min_size:
        raise HTTPException(status_code=400, detail="图片尺寸太小，无法生成九宫格")
    if img_width * img_height > 20000 * 20000:
        raise HTTPException(status_code=400, detail="图片尺寸过大（最大 20000x20000 像素）")

    pd = max(0, min(200, int(padding)))
    sep = max(0, int(gap)) + max(0, int(line_width))
    out_w = img_width + sep * 2 + pd * 2
    out_h = img_height + sep * 2 + pd * 2
    if out_w > 24000 or out_h > 24000:
        raise HTTPException(status_code=400, detail="参数过大，生成图尺寸超限（最大 24000 像素）")


def _parse_hex_color(value: str) -> tuple[int, int, int, int] | None:
    s = (value or "").strip()
    if not s:
        return None
    if s.startswith("#"):
        s = s[1:]
    if len(s) not in (6, 8):
        return None
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        a = int(s[6:8], 16) if len(s) == 8 else 255
        return (r, g, b, a)
    except ValueError:
        return None


def _require_hex_color(value: str, *, field: str) -> tuple[int, int, int, int]:
    c = _parse_hex_color(value)
    if c is None:
        raise HTTPException(status_code=400, detail=f"{field} 颜色格式错误（支持 #RRGGBB 或 #RRGGBBAA）")
    return c


def _normalize_output_format(value: str) -> str:
    v = (value or "").strip().upper()
    if v in ("JPG", "JPEG"):
        return "JPEG"
    if v == "PNG":
        return "PNG"
    return "JPEG"


@router.post("/preview")
async def grid_preview(
    file: UploadFile = File(...),
    line_width: int = Form(default=2),
    gap: int = Form(default=0),
    padding: int = Form(default=0),
    line_color: str = Form(default="#ffffff"),
    bg_color: str = Form(default="#ffffff"),
    output_format: str = Form(default="JPEG"),
    transparent_bg: bool = Form(default=False),
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
        _ = img.load()
        _validate_grid_params(line_width, gap, img.width, img.height, padding)
    except (UnidentifiedImageError, DecompressionBombError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"无效的图片文件: {str(e)}")

    fmt = _normalize_output_format(output_format)
    ext: str = "png" if fmt == "PNG" else "jpg"
    if transparent_bg and fmt != "PNG":
        raise HTTPException(status_code=400, detail="透明背景仅支持 PNG 格式")
    lc = _require_hex_color(line_color, field="线色")
    bc = _require_hex_color(bg_color, field="背景色")
    pd = max(0, min(200, int(padding)))

    preview_bytes = generate_grid_preview(
        source_image=img,
        line_width=line_width,
        gap=gap,
        padding=pd,
        line_color=lc,
        bg_color=(bc[0], bc[1], bc[2]),
        output_format=fmt,
        transparent_bg=transparent_bg,
        quality=95,
    )

    safe_name = _safe_filename(file.filename or "preview")
    ext = "png" if fmt == "PNG" else "jpg"
    media_type = "image/png" if fmt == "PNG" else "image/jpeg"
    return Response(
        content=preview_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{safe_name}.{ext}"'},
    )


@router.post("/split")
async def grid_split(
    file: UploadFile = File(...),
    line_width: int = Form(default=2),
    gap: int = Form(default=0),
    padding: int = Form(default=0),
    line_color: str = Form(default="#ffffff"),
    bg_color: str = Form(default="#ffffff"),
    output_format: str = Form(default="JPEG"),
    transparent_bg: bool = Form(default=False),
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
        _ = img.load()
        _validate_grid_params(line_width, gap, img.width, img.height, padding)
    except (UnidentifiedImageError, DecompressionBombError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"无效的图片文件: {str(e)}")

    fmt = _normalize_output_format(output_format)
    ext = "png" if fmt == "PNG" else "jpg"
    if transparent_bg and fmt != "PNG":
        raise HTTPException(status_code=400, detail="透明背景仅支持 PNG 格式")
    lc = _require_hex_color(line_color, field="线色")
    bc = _require_hex_color(bg_color, field="背景色")
    pd = max(0, min(200, int(padding)))

    preview_bytes, tile_bytes_list = process_nine_grid(
        source_image=img,
        draw_grid=True,
        line_width=line_width,
        gap=gap,
        padding=pd,
        line_color=lc,
        bg_color=(bc[0], bc[1], bc[2]),
        transparent_bg=transparent_bg,
        output_format=fmt,
        quality=95,
    )

    safe_stem = _safe_filename(file.filename or "image")
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        ext = "png" if fmt == "PNG" else "jpg"
        zf.writestr(f"{safe_stem}_preview.{ext}", preview_bytes)
        for i, tile_bytes in enumerate(tile_bytes_list, 1):
            zf.writestr(f"{safe_stem}_{i}.{ext}", tile_bytes)

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
    padding: int = Form(default=0),
    line_color: str = Form(default="#ffffff"),
    bg_color: str = Form(default="#ffffff"),
    output_format: str = Form(default="JPEG"),
    transparent_bg: bool = Form(default=False),
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
        _ = img.load()
        _validate_grid_params(line_width, gap, img.width, img.height, padding)
    except (UnidentifiedImageError, DecompressionBombError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"无效的图片文件: {str(e)}")

    fmt = _normalize_output_format(output_format)
    ext = "png" if fmt == "PNG" else "jpg"
    if transparent_bg and fmt != "PNG":
        raise HTTPException(status_code=400, detail="透明背景仅支持 PNG 格式")
    lc = _require_hex_color(line_color, field="线色")
    bc = _require_hex_color(bg_color, field="背景色")
    pd = max(0, min(200, int(padding)))

    preview_bytes, tile_bytes_list = process_nine_grid(
        source_image=img,
        draw_grid=True,
        line_width=line_width,
        gap=gap,
        padding=pd,
        line_color=lc,
        bg_color=(bc[0], bc[1], bc[2]),
        transparent_bg=transparent_bg,
        output_format=fmt,
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
        filename = f"{safe_stem}_{i}.{ext}"
        _ = (target_dir / filename).write_bytes(tile_bytes)
        saved_files.append(filename)
        append_in_order(target_path, filename)

    preview_name = f"{safe_stem}_preview.{ext}"
    _ = (target_dir / preview_name).write_bytes(preview_bytes)
    saved_files.insert(0, preview_name)
    append_in_order(target_path, preview_name)

    return {
        "ok": True,
        "destination": target_path,
        "files": saved_files,
        "count": len(saved_files),
    }
