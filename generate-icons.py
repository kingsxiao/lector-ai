#!/usr/bin/env python3
"""
Render Lector AI's extension icons from the SVG sources.

The icons are authored as SVG (icons/icon.svg for 48/128px and
icons/icon-small.svg for the 16px simplified variant) and rasterized with
rsvg-convert. The brand mark is a white geometric "L" with an AI sparkle, on
the warm-brown gradient (#9C6B3C → #875A2F → #6B4A24) that matches the app's
Editorial theme tokens (src/styles/tokens.css: --accent / --accent-hover).

Prerequisites (macOS):
    brew install librsvg

If rsvg-convert is missing, this script will print install instructions and exit.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC_LARGE = ROOT / "icons" / "icon.svg"        # used for 48 + 128
SRC_SMALL = ROOT / "icons" / "icon-small.svg"  # simplified, for 16
DEST = ROOT / "public" / "icons"

SIZES = [
    (16, SRC_SMALL),
    # 32 is used by Chrome in several surfaces (Windows taskbar, history);
    # letting it downscale 48 made edges soft.
    (32, SRC_LARGE),
    (48, SRC_LARGE),
    (128, SRC_LARGE),
]


def main() -> int:
    if not shutil.which("rsvg-convert"):
        print("rsvg-convert not found. Install it with:\n  brew install librsvg", file=sys.stderr)
        return 1

    DEST.mkdir(parents=True, exist_ok=True)

    for size, src in SIZES:
        out = DEST / f"icon{size}.png"
        subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size), str(src), "-o", str(out)],
            check=True,
        )
        print(f"Created {out.relative_to(ROOT)} ({size}x{size}) from {src.relative_to(ROOT)}")

    print("Done!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
