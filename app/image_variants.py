from __future__ import annotations

import os
import subprocess
import threading
from pathlib import Path


_FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")
_THUMB_WIDTH = max(320, int(os.environ.get("IMG_THUMB_WIDTH", "1080")))
_THUMB_AVIF_CRF = max(18, min(50, int(os.environ.get("IMG_THUMB_AVIF_CRF", "36"))))
_DOWNLOAD_JPEG_QV = max(2, min(20, int(os.environ.get("IMG_DOWNLOAD_JPEG_QV", "3"))))

_VARIANT_DIRNAME = ".pfv"
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _path_lock(target: Path) -> threading.Lock:
    key = str(target)
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _LOCKS[key] = lock
        return lock


def _variant_root(src: Path) -> Path:
    return src.parent / _VARIANT_DIRNAME / src.name


def _is_stale(src: Path, target: Path) -> bool:
    if not target.exists():
        return True
    try:
        return target.stat().st_mtime < src.stat().st_mtime
    except OSError:
        return True


def _run_ffmpeg(args: list[str], timeout_s: int = 120) -> None:
    subprocess.run([_FFMPEG_BIN, *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout_s)


def _ensure_thumb_avif(src: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    vf = f"scale=min({_THUMB_WIDTH}\\,iw):-2:flags=lanczos,format=yuv420p"
    _run_ffmpeg([
        "-y",
        "-i",
        str(src),
        "-vf",
        vf,
        "-frames:v",
        "1",
        "-c:v",
        "libaom-av1",
        "-still-picture",
        "1",
        "-cpu-used",
        "6",
        "-crf",
        str(_THUMB_AVIF_CRF),
        "-b:v",
        "0",
        str(target),
    ])
    return target


def _ensure_download_jpeg(src: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg([
        "-y",
        "-i",
        str(src),
        "-frames:v",
        "1",
        "-q:v",
        str(_DOWNLOAD_JPEG_QV),
        "-pix_fmt",
        "yuvj420p",
        str(target),
    ])
    return target


def _ensure_one(src: Path, target: Path, builder) -> Path:
    lock = _path_lock(target)
    with lock:
        if _is_stale(src, target):
            builder(src, target)
    return target


def thumb_avif_path(src: Path) -> Path:
    return _variant_root(src) / f"thumb-{_THUMB_WIDTH}w-q{_THUMB_AVIF_CRF}.avif"


def download_jpeg_path(src: Path) -> Path:
    return _variant_root(src) / f"download-q{_DOWNLOAD_JPEG_QV}.jpg"


def ensure_thumb_avif(src: Path) -> Path:
    return _ensure_one(src, thumb_avif_path(src), _ensure_thumb_avif)


def ensure_download_jpeg(src: Path) -> Path:
    return _ensure_one(src, download_jpeg_path(src), _ensure_download_jpeg)


def ensure_all_variants_best_effort(src: Path) -> None:
    try:
        ensure_thumb_avif(src)
        ensure_download_jpeg(src)
    except Exception:
        return


def remove_variants_for_source(src: Path) -> None:
    root = _variant_root(src)
    if not root.exists():
        return
    for p in sorted(root.glob("*")):
        if p.is_file():
            p.unlink(missing_ok=True)
    root.rmdir()
    parent = root.parent
    if parent.exists() and not any(parent.iterdir()):
        parent.rmdir()
