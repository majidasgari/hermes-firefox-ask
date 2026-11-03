#!/usr/bin/env python3
"""Generate the add-on icons (flat blue tile + white speech bubble). Run once: python3 tools/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'extension' / 'icons'
ACCENT = (31, 111, 235, 255)
SIZES = (16, 32, 48, 96, 128)


def icon(size: int) -> Image.Image:
    scale = 8  # draw big, downscale for clean edges
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=ACCENT)
    pad = int(s * 0.2)
    box = (pad, int(s * 0.24), s - pad, int(s * 0.68))
    d.rounded_rectangle(box, radius=int(s * 0.09), fill=(255, 255, 255, 255))
    tail = [
        (int(s * 0.32), box[3] - 1),
        (int(s * 0.30), int(s * 0.78)),
        (int(s * 0.48), box[3] - 1),
    ]
    d.polygon(tail, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        icon(size).save(OUT / f'icon-{size}.png')
        print('wrote', OUT / f'icon-{size}.png')


if __name__ == '__main__':
    main()
