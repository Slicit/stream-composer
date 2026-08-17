#!/usr/bin/env python3
"""Trim, downscale and quantise the raw captures into docs/screenshots/.

Captures come out at 2x device pixel ratio, which is far more than a README
needs. Downscaling to 1600px and quantising to a 256-colour palette keeps the
text crisp while dropping the set from several megabytes to well under one.

    scripts/screenshots-optimise.py <src-dir> <dest-dir>
"""
import sys
from pathlib import Path

from PIL import Image

TARGET_WIDTH = 1600

FILES = [
    ('02-viewer.png', 'viewer.png'),
    ('08-audio-monitor.png', 'viewer-audio.png'),
    ('01-login.png', 'login.png'),
    ('03-admin-streams.png', 'admin-streams.png'),
    ('04-admin-composition.png', 'admin-composition.png'),
    ('05-admin-users.png', 'admin-users.png'),
    ('06-admin-server.png', 'admin-server.png'),
    ('07-admin-logs.png', 'admin-logs.png'),
    ('09-admin-restream.png', 'admin-restream.png'),
]


def trim_bottom(img, pad=32):
    """Drop uniform rows at the bottom, keeping a little breathing room."""
    w, h = img.size
    rgb = img.convert('RGB')
    bg = rgb.getpixel((w - 4, h - 4))
    step = max(1, w // 80)
    for y in range(h - 1, 0, -8):
        row = (rgb.getpixel((x, y)) for x in range(0, w, step))
        if any(sum(abs(p[i] - bg[i]) for i in range(3)) > 24 for p in row):
            return img.crop((0, 0, w, min(h, y + pad)))
    return img


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dest = Path(sys.argv[1]), Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)

    for name, out_name in FILES:
        path = src / name
        if not path.exists():
            print(f'    skipped {out_name} (no capture)')
            continue
        img = trim_bottom(Image.open(path))
        if img.width > TARGET_WIDTH:
            height = round(img.height * TARGET_WIDTH / img.width)
            img = img.resize((TARGET_WIDTH, height), Image.LANCZOS)
        img = img.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=256)
        out = dest / out_name
        img.save(out, 'PNG', optimize=True)
        print(f'    {out_name:24} {img.width}x{img.height}  {out.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
