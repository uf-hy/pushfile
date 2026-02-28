import io
import importlib
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from app.storage import ALLOWED_SUFFIX, resolve_slug
from app.auth import safe_token, safe_name, token_dir, resolve_dir

Image = None
ImageOps = None
try:
    pil_image = importlib.import_module("PIL.Image")
    pil_image_ops = importlib.import_module("PIL.ImageOps")
    Image = pil_image
    ImageOps = pil_image_ops
except Exception:
    pass

router = APIRouter(tags=["files"])

# Map suffix to MIME type for explicit Content-Type
_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def _resolve_file(token: str, filename: str) -> Path:
    token = safe_token(token)
    filename = safe_name(filename)

    # Support slug albums: resolve slug -> real path -> directory
    real_path = resolve_slug(token)
    if real_path:
        d = resolve_dir(real_path).resolve()
    else:
        d = token_dir(token).resolve()

    f = (d / filename).resolve()

    # Safe directory containment check (not startswith)
    if not f.is_relative_to(d) or not f.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if f.suffix.lower() not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=404, detail="file not found")
    return f


@router.get("/d/{token}/{filename}")
def serve_image(token: str, filename: str):
    """Serve image inline (browser displays it)."""
    f = _resolve_file(token, filename)
    mime = _MIME.get(f.suffix.lower(), "application/octet-stream")
    return FileResponse(f, media_type=mime)


@router.get("/f/{token}/{filename}")
def download_image(token: str, filename: str):
    f = _resolve_file(token, filename)
    if Image and ImageOps:
        try:
            with Image.open(f) as im:
                im = ImageOps.exif_transpose(im)
                if im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=88, optimize=True)
                out_name = f"{f.stem}.jpg"
                headers = {"Content-Disposition": f"attachment; filename*=utf-8''{out_name}"}
                return Response(content=buf.getvalue(), media_type="image/jpeg", headers=headers)
        except Exception:
            pass
    return FileResponse(f, filename=f.name, content_disposition_type="attachment")


@router.get("/v/{token}/{filename}")
def view_image(
    request: Request,
    token: str,
    filename: str,
    kind: str | None = None,
    src: str | None = None,
):
    target_name = src or filename
    f = _resolve_file(token, target_name)
    mode = (kind or "").strip().lower()

    if mode and Image and ImageOps:
        try:
            with Image.open(f) as im:
                im = ImageOps.exif_transpose(im)
                if mode == "view-jpg":
                    im.thumbnail((2200, 2200))
                    if im.mode not in ("RGB", "L"):
                        im = im.convert("RGB")
                    buf = io.BytesIO()
                    im.save(buf, format="JPEG", quality=85, optimize=True)
                    return Response(content=buf.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})

                if mode in {"thumb-avif", "thumb", "thumb-webp", "thumb-auto"}:
                    im.thumbnail((720, 720))
                    if im.mode not in ("RGB", "RGBA", "L"):
                        im = im.convert("RGB")
                    buf = io.BytesIO()
                    accept = (request.headers.get("accept") or "").lower()
                    prefer_avif = (mode == "thumb-avif") or (mode == "thumb-auto" and "image/avif" in accept)
                    if prefer_avif:
                        try:
                            im.save(buf, format="AVIF", quality=50)
                            return Response(content=buf.getvalue(), media_type="image/avif", headers={"Cache-Control": "public, max-age=604800"})
                        except Exception:
                            buf = io.BytesIO()
                    im.save(buf, format="WEBP", quality=70, method=6)
                    return Response(content=buf.getvalue(), media_type="image/webp", headers={"Cache-Control": "public, max-age=604800"})
        except Exception:
            pass

    mime = _MIME.get(f.suffix.lower(), "application/octet-stream")
    return FileResponse(f, media_type=mime)
