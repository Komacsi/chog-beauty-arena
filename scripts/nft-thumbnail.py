"""Produce a bounded display preview from a cached public NFT image."""
import json
import re
import sys
import uuid
import warnings
from pathlib import Path
from PIL import Image, ImageOps

source = Path(sys.argv[1]).resolve(strict=True)
if not re.fullmatch(r"[1-9][0-9]*-[a-f0-9]{16}\.image", source.name):
    raise ValueError("Expected a catalog image cache file")
Image.MAX_IMAGE_PIXELS = 16_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
target = Path(str(source) + ".thumb.webp")
temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".tmp")
try:
    with Image.open(source) as original:
        original.seek(0)
        preview = ImageOps.exif_transpose(original).convert("RGBA")
        preview.thumbnail((384, 384), Image.Resampling.LANCZOS)
        preview.save(temporary, format="WEBP", quality=82, method=4)
        if temporary.stat().st_size > 512 * 1024:
            raise ValueError("Preview exceeds its size limit")
        temporary.replace(target)
    print(json.dumps({"originalBytes": source.stat().st_size, "previewBytes": target.stat().st_size}))
finally:
    temporary.unlink(missing_ok=True)
