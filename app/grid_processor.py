from __future__ import annotations

import io
from typing import Tuple, Optional

from PIL import Image, ImageDraw


def resize_if_large(image: Image.Image, max_dimension: int = 2048) -> Image.Image:
    """如果图片尺寸过大，按比例缩小

    Args:
        image: PIL Image 对象
        max_dimension: 最大边长（像素）

    Returns:
        处理后的 Image 对象
    """
    w, h = image.size
    if w <= max_dimension and h <= max_dimension:
        return image

    if w > h:
        new_w = max_dimension
        new_h = int(h * max_dimension / w)
    else:
        new_h = max_dimension
        new_w = int(w * max_dimension / h)

    return image.resize((new_w, new_h), Image.Resampling.LANCZOS)


def convert_to_rgb(
    image: Image.Image, bg_color: Tuple[int, int, int] = (255, 255, 255)
) -> Image.Image:
    """将图片转换为 RGB 模式，正确处理透明背景

    Args:
        image: PIL Image 对象
        bg_color: 背景颜色 (R, G, B)

    Returns:
        RGB 模式的 Image 对象
    """
    if image.mode == "RGB":
        return image
    image_rgba = image.convert("RGBA")
    background = Image.new("RGBA", image_rgba.size, (*bg_color, 255))
    alpha_composite = Image.alpha_composite(background, image_rgba)
    return alpha_composite.convert("RGB")


def _clamp_int(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(v)))


def _normalize_rgba(color: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
    r, g, b, a = color
    return (
        _clamp_int(r, 0, 255),
        _clamp_int(g, 0, 255),
        _clamp_int(b, 0, 255),
        _clamp_int(a, 0, 255),
    )


def compose_nine_grid_preview(
    source_image: Image.Image,
    line_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
    line_width: int = 2,
    gap: int = 0,
    padding: int = 0,
    bg_color: Optional[Tuple[int, int, int, int]] = (255, 255, 255, 255),
) -> Image.Image:
    lw = max(0, int(line_width))
    gp = max(0, int(gap))
    pd = max(0, int(padding))
    sep = gp + lw

    tiles = split_into_grid(source_image, grid_size=3)

    w, h = source_image.size
    tile_w = w // 3
    tile_h = h // 3
    col_widths = [tile_w, tile_w, w - tile_w * 2]
    row_heights = [tile_h, tile_h, h - tile_h * 2]

    out_w = sum(col_widths) + sep * 2 + pd * 2
    out_h = sum(row_heights) + sep * 2 + pd * 2

    if bg_color is None:
        bg = (0, 0, 0, 0)
    else:
        bg = _normalize_rgba(bg_color)
    canvas = Image.new("RGBA", (out_w, out_h), bg)

    idx = 0
    y = pd
    for r in range(3):
        x = pd
        for c in range(3):
            tile = tiles[idx]
            idx += 1
            if tile.mode != "RGBA":
                tile = tile.convert("RGBA")
            canvas.paste(tile, (x, y))
            x += col_widths[c]
            if c < 2:
                x += sep
        y += row_heights[r]
        if r < 2:
            y += sep

    if sep > 0 and lw > 0:
        draw = ImageDraw.Draw(canvas)
        lc = _normalize_rgba(line_color)

        content_w = sum(col_widths) + sep * 2
        content_h = sum(row_heights) + sep * 2
        content_left = pd
        content_top = pd

        x1 = content_left + col_widths[0]
        x2 = content_left + col_widths[0] + sep + col_widths[1]
        for x_sep in (x1, x2):
            line_left = x_sep + (sep - lw) // 2
            line_right = line_left + lw
            draw.rectangle(
                [(line_left, content_top), (line_right - 1, content_top + content_h - 1)],
                fill=lc,
            )

        y1 = content_top + row_heights[0]
        y2 = content_top + row_heights[0] + sep + row_heights[1]
        for y_sep in (y1, y2):
            line_top = y_sep + (sep - lw) // 2
            line_bottom = line_top + lw
            draw.rectangle(
                [(content_left, line_top), (content_left + content_w - 1, line_bottom - 1)],
                fill=lc,
            )

    return canvas


def draw_grid_lines(
    image: Image.Image,
    line_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
    line_width: int = 2,
    gap: int = 0,
    bg_color: Tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    return compose_nine_grid_preview(
        source_image=image,
        line_color=line_color,
        line_width=line_width,
        gap=gap,
        padding=0,
        bg_color=(*bg_color, 255),
    )


def split_into_grid(image: Image.Image, grid_size: int = 3) -> list[Image.Image]:
    """将图片等分成 grid_size x grid_size 的网格

    Args:
        image: PIL Image 对象
        grid_size: 网格大小，默认 3 (3x3 九宫格)

    Returns:
        分割后的图片列表（从左到右，从上到下）
    """
    w, h = image.size
    tile_w = w // grid_size
    tile_h = h // grid_size

    tiles: list[Image.Image] = []
    for row in range(grid_size):
        for col in range(grid_size):
            left = col * tile_w
            upper = row * tile_h
            # 最后一列/行吃掉剩余像素，避免缝隙
            right = (col + 1) * tile_w if col < grid_size - 1 else w
            lower = (row + 1) * tile_h if row < grid_size - 1 else h
            tiles.append(image.crop((left, upper, right, lower)))

    return tiles


def process_nine_grid(
    source_image: Image.Image,
    draw_grid: bool = True,
    line_width: int = 2,
    gap: int = 0,
    line_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
    bg_color: Tuple[int, int, int] = (255, 255, 255),
    padding: int = 0,
    transparent_bg: bool = False,
    output_format: str = "JPEG",
    quality: int = 95,
) -> Tuple[bytes, list[bytes]]:
    """处理九宫格图片

    Args:
        source_image: 源图片 PIL Image 对象
        draw_grid: 是否在预览图上绘制网格线
        line_width: 线条宽度
        gap: 网格间距
        line_color: 线条颜色
        bg_color: JPEG 输出时的背景色
        output_format: 输出格式（JPEG/PNG）
        quality: JPEG 质量 (1-100)

    Returns:
        (预览图字节, [9张分割图字节列表])
    """
    if draw_grid:
        preview_bg: Optional[Tuple[int, int, int, int]]
        if transparent_bg and output_format.upper() == "PNG":
            preview_bg = None
        else:
            preview_bg = (*bg_color, 255)
        preview = compose_nine_grid_preview(
            source_image=source_image,
            line_color=line_color,
            line_width=line_width,
            gap=gap,
            padding=padding,
            bg_color=preview_bg,
        )
    else:
        preview = source_image.copy()

    # 分割成 9 张小图
    tiles = split_into_grid(source_image, grid_size=3)

    # 转换并编码为字节
    def encode_image(img: Image.Image) -> bytes:
        buffer = io.BytesIO()
        if output_format.upper() == "JPEG":
            img = convert_to_rgb(img, bg_color)
            img.save(buffer, format="JPEG", quality=quality, subsampling=0)
        else:
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            img.save(buffer, format="PNG")
        return buffer.getvalue()

    preview_bytes = encode_image(preview)
    tile_bytes_list = [encode_image(tile) for tile in tiles]

    return preview_bytes, tile_bytes_list


def generate_grid_preview(
    source_image: Image.Image,
    line_width: int = 2,
    gap: int = 0,
    line_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
    bg_color: Tuple[int, int, int] = (255, 255, 255),
    padding: int = 0,
    transparent_bg: bool = False,
    output_format: str = "JPEG",
    quality: int = 95,
) -> bytes:
    preview_bg: Optional[Tuple[int, int, int, int]]
    if transparent_bg and output_format.upper() == "PNG":
        preview_bg = None
    else:
        preview_bg = (*bg_color, 255)
    preview = compose_nine_grid_preview(
        source_image=source_image,
        line_color=line_color,
        line_width=line_width,
        gap=gap,
        padding=padding,
        bg_color=preview_bg,
    )
    buffer = io.BytesIO()
    if output_format.upper() == "JPEG":
        preview = convert_to_rgb(preview, bg_color)
        preview.save(buffer, format="JPEG", quality=quality, subsampling=0)
    else:
        if preview.mode != "RGBA":
            preview = preview.convert("RGBA")
        preview.save(buffer, format="PNG")
    return buffer.getvalue()
