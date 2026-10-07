"""Embed the painted world art (local ComfyUI renders) into src/world.js as small JPEG data URIs.

Usage: python tests/world_art.py <folder with pan_*.png and holo_*.png>
Panoramas -> 768x256, holograms -> 192x256 (koi 256x192). Re-running replaces the previous art block.
"""
import base64
import io
import os
import re
import sys

from PIL import Image

SRC = sys.argv[1]
WORLD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "world.js")
SIZES = {"pan_canyon": (768, 256), "pan_stacks": (768, 256), "pan_arcology": (768, 256), "pan_dust": (768, 256), "pan_sea": (768, 256),
         "holo_face": (192, 256), "holo_dancer": (192, 256), "holo_koi": (256, 192)}

parts = []
total = 0
for name, size in SIZES.items():
    path = os.path.join(SRC, name + ".png")
    if not os.path.exists(path):
        print("missing", name)
        continue
    im = Image.open(path).convert("RGB").resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72, optimize=True, progressive=False)
    b64 = base64.b64encode(buf.getvalue()).decode()
    total += len(b64)
    parts.append(f"\n    {name}: 'data:image/jpeg;base64,{b64}'")
js = open(WORLD, encoding="utf-8").read()
new, n = re.subn(r"function worldArt\(\) \{ return \{.*?\}; \}", lambda m: "function worldArt() { return {/*ART*/" + ",".join(parts) + "\n  }; }", js, flags=re.S)
assert n == 1, "art block not found"
open(WORLD, "w", encoding="utf-8").write(new)
print(f"embedded {len(parts)} images, {total / 1024:.0f} KB base64")
