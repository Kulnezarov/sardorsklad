"""Сжатие и сохранение фото позиций накладной (до загрузки на склад)."""
import os
import re
from pathlib import Path

from PIL import UnidentifiedImageError

from services.image_encode import (
    MAX_IMAGE_DIMENSION,
    bytes_to_avif,
    intake_image_basename,
    is_safe_intake_image_name,
)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads")).resolve()
INTAKE_IMAGE_DIR = UPLOAD_DIR / "intake"
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
MAX_INTAKE_LINE_IMAGES = 12

_SAFE_SEGMENT = re.compile(r"[^a-zA-Z0-9_-]+")
_SAFE_INTAKE_BASENAME = re.compile(
    r"^u\d+_[0-9a-zA-Z_-]{1,64}_[0-9a-zA-Z_-]{1,64}_[0-9a-f]{32}\.(?:avif|webp)$",
    re.IGNORECASE,
)


def sanitize_segment(value: str, max_len: int = 48) -> str:
    s = _SAFE_SEGMENT.sub("_", (value or "").strip())[:max_len]
    return s or "line"


def intake_public_url(file_name: str) -> str:
    return f"/api/v1/media/intake-images/{file_name}"


def save_intake_line_image(
    *,
    user_id: int,
    client_id: str,
    line_local_id: str,
    data: bytes,
) -> str:
    encoded, _, _ = bytes_to_avif(data)
    INTAKE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    safe_client = sanitize_segment(client_id)
    safe_line = sanitize_segment(line_local_id)
    file_name = intake_image_basename(
        user_id=user_id,
        safe_client=safe_client,
        safe_line=safe_line,
    )
    (INTAKE_IMAGE_DIR / file_name).write_bytes(encoded)
    return intake_public_url(file_name)


def resolve_intake_image_path(file_name: str) -> Path | None:
    if not file_name or not is_safe_intake_image_name(file_name):
        return None
    path = (INTAKE_IMAGE_DIR / file_name).resolve()
    try:
        path.relative_to(INTAKE_IMAGE_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None
