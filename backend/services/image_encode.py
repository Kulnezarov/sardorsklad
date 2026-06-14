"""Сжатие загруженных фото в AVIF (старые .webp по-прежнему читаются и удаляются)."""
import re
import uuid
from io import BytesIO

from PIL import Image, ImageOps

try:
    import pillow_avif  # noqa: F401 — регистрирует AVIF в Pillow
except ImportError:
    pillow_avif = None

MAX_IMAGE_DIMENSION = 1600
AVIF_QUALITY = 60
IMAGE_EXTENSION = "avif"

_SAFE_PRODUCT_IMAGE = re.compile(
    r"^\d+_[0-9a-f]{32}\.(?:avif|webp)$",
    re.IGNORECASE,
)
_SAFE_INTAKE_IMAGE = re.compile(
    r"^u\d+_[0-9a-zA-Z_-]{1,64}_[0-9a-zA-Z_-]{1,64}_[0-9a-f]{32}\.(?:avif|webp)$",
    re.IGNORECASE,
)


def ensure_avif_plugin() -> None:
    if pillow_avif is None:
        raise RuntimeError("Установите pillow-avif-plugin для сохранения фото в AVIF")


def is_safe_product_image_name(name: str) -> bool:
    return bool(name and _SAFE_PRODUCT_IMAGE.match(name))


def is_safe_intake_image_name(name: str) -> bool:
    return bool(name and _SAFE_INTAKE_IMAGE.match(name))


def media_type_for_filename(file_name: str) -> str:
    lower = (file_name or "").lower()
    if lower.endswith(".avif"):
        return "image/avif"
    if lower.endswith(".webp"):
        return "image/webp"
    return "application/octet-stream"


def product_image_basename(product_id: int) -> str:
    return f"{product_id}_{uuid.uuid4().hex}.{IMAGE_EXTENSION}"


def intake_image_basename(*, user_id: int, safe_client: str, safe_line: str) -> str:
    return f"u{user_id}_{safe_client}_{safe_line}_{uuid.uuid4().hex}.{IMAGE_EXTENSION}"


def prepare_image(img: Image.Image) -> Image.Image:
    """JPEG/PNG/WebP/AVIF → RGB для стабильной записи AVIF."""
    img = ImageOps.exif_transpose(img)
    mode = img.mode
    if mode == "CMYK":
        return img.convert("RGB")
    if mode == "P":
        if "transparency" in img.info:
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            return bg
        return img.convert("RGB")
    if mode in ("PA", "LA"):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        return bg
    if mode == "L":
        return img.convert("RGB")
    if mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        return bg
    if mode == "RGB":
        return img
    has_a = "A" in (img.getbands() or ())
    tr = bool(getattr(img, "has_transparency_data", False) or has_a)
    if tr:
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        return bg
    return img.convert("RGB")


def bytes_to_avif(data: bytes) -> tuple[bytes, int, int]:
    ensure_avif_plugin()
    with Image.open(BytesIO(data)) as img:
        img = prepare_image(img)
        img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
        w, h = int(img.size[0] or 0), int(img.size[1] or 0)
        out = BytesIO()
        img.save(
            out,
            format="AVIF",
            quality=AVIF_QUALITY,
            speed=6,
        )
        return out.getvalue(), w, h
