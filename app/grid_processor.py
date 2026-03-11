"""九宫格图片处理模块

功能：
1. 将图片分割成 3x3 九宫格
2. 在图片上绘制网格线（朋友圈风格）
3. 支持透明度处理和 JPEG 输出
"""

from __future__ import annotations

import io
from typing import Tuple

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


def draw_grid_lines(
    image: Image.Image,
    line_color: Tuple[int, int, int, int] = (255, 255, 255, 255),
    line_width: int = 2,
    gap: int = 0,
    bg_color: Tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """在图片上绘制九宫格网格线

    Args:
        image: PIL Image 对象
        line_color: 线条颜色 (R, G, B, A)，默认白色
        line_width: 线条宽度（像素）
        gap: 网格间距（像素），0 表示无间距
        bg_color: 间距背景色 (R, G, B)

    Returns:
        带网格线的 Image 对象
    """
    if image.mode != "RGBA":
        img = image.convert("RGBA")
    else:
        img = image.copy()

    orig_w, orig_h = img.size

    if gap > 0:
        cell_w = (orig_w - gap * 4) // 3
        cell_h = (orig_h - gap * 4) // 3
        result = Image.new("RGBA", (orig_w, orig_h), (*bg_color, 255))
        for row in range(3):
            for col in range(3):
                src_left = col * (orig_w // 3)
                src_upper = row * (orig_h // 3)
                src_right = (col + 1) * (orig_w // 3) if col < 2 else orig_w
                src_lower = (row + 1) * (orig_h // 3) if row < 2 else orig_h
                cell = img.crop((src_left, src_upper, src_right, src_lower))
                cell = cell.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
                dst_left = col * (cell_w + gap) + gap
                dst_upper = row * (cell_h + gap) + gap
                result.paste(cell, (dst_left, dst_upper))
        draw = ImageDraw.Draw(result)
        for row in range(3):
            for col in range(3):
                left = col * (cell_w + gap) + gap
                upper = row * (cell_h + gap) + gap
                right = left + cell_w
                lower = upper + cell_h
                draw.rectangle(
                    [(left, upper), (right, lower)],
                    outline=line_color[:3],
                    width=line_width,
                )
        return result
    else:
        draw = ImageDraw.Draw(img)
        for i in range(1, 3):
            x = round(i * orig_w / 3)
            draw.line([(x, 0), (x, orig_h)], fill=line_color, width=line_width)
            y = round(i * orig_h / 3)
            draw.line([(0, y), (orig_w, y)], fill=line_color, width=line_width)
        return img


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
    # 处理预览图
    if draw_grid:
        preview = draw_grid_lines(source_image, line_color, line_width, gap)
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
    output_format: str = "JPEG",
    quality: int = 95,
) -> bytes:
    preview = draw_grid_lines(source_image, line_color, line_width, gap)
    buffer = io.BytesIO()
    if output_format.upper() == "JPEG":
        preview = convert_to_rgb(preview)
        preview.save(buffer, format="JPEG", quality=quality, subsampling=0)
    else:
        if preview.mode != "RGBA":
            preview = preview.convert("RGBA")
        preview.save(buffer, format="PNG")
    return buffer.getvalue()
