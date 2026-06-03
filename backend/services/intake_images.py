"""Сжатие и сохранение фото позиций накладной (до загрузки на склад)."""
import os
import re
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads")).resolve()
INTAKE_IMAGE_DIR = UPLOAD_DIR / "intake"
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_DIMENSION = 1600
WEBP_QUALITY = 78
MAX_INTAKE_LINE_IMAGES = 12

_SAFE_SEGMENT = re.compile(r"[^a-zA-Z0-9_-]+")
_SAFE_INTAKE_BASENAME = re.compile(
    r"^u\d+_[0-9a-zA-Z_-]{1,64}_[0-9a-zA-Z_-]{1,64}_[0-9a-f]{32}\.webp$",
    re.IGNORECASE,
)


def sanitize_segment(value: str, max_len: int = 48) -> str:
    s = _SAFE_SEGMENT.sub("_", (value or "").strip())[:max_len]
    return s or "line"


def bytes_to_webp(data: bytes) -> tuple[bytes, int, int]:
    with Image.open(BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        elif img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
        w, h = int(img.size[0] or 0), int(img.size[1] or 0)
        out = BytesIO()
        img.save(out, format="WEBP", quality=WEBP_QUALITY, method=6, optimize=True)
        return out.getvalue(), w, h


def intake_public_url(file_name: str) -> str:
    return f"/api/v1/media/intake-images/{file_name}"


def save_intake_line_image(
    *,
    user_id: int,
    client_id: str,
    line_local_id: str,
    data: bytes,
) -> str:
    encoded, _, _ = bytes_to_webp(data)
    INTAKE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    safe_client = sanitize_segment(client_id)
    safe_line = sanitize_segment(line_local_id)
    file_name = f"u{user_id}_{safe_client}_{safe_line}_{uuid.uuid4().hex}.webp"
    (INTAKE_IMAGE_DIR / file_name).write_bytes(encoded)
    return intake_public_url(file_name)


def resolve_intake_image_path(file_name: str) -> Path | None:
    if not file_name or not _SAFE_INTAKE_BASENAME.match(file_name):
        return None
    path = (INTAKE_IMAGE_DIR / file_name).resolve()
    try:
        path.relative_to(INTAKE_IMAGE_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None
