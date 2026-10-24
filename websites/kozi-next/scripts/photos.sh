#!/usr/bin/env bash
# Grade and resize the unit photos into src/assets/photos (run once per new shoot).
# Kozi grade: a touch less saturation, warmer highlights, calmer blues, lifted blacks, faint amber cast.
set -euo pipefail
SRC="${KOZI_PHOTOS:-/mnt/project-files/otto-listings/photos}"
OUT="$(dirname "$0")/../src/assets/photos"
grade() { # src dst
  mkdir -p "$(dirname "$2")"
  convert "$1" -auto-orient -resize '2400x2400>' \
    -modulate 100,92,100 \
    -channel B -evaluate multiply 0.96 +channel \
    -channel R -evaluate multiply 1.02 +channel \
    +level 3%,98% \
    -fill '#E9C98F' -colorize 4% \
    -strip -interlace Plane -quality 86 "$2"
}
for f in "$SRC"/boutique/2026-10-20/*.jpg; do grade "$f" "$OUT/boutique/$(basename "$f")"; done
for f in "$SRC"/premium/unit-a-2026-10-20/*.jpg; do grade "$f" "$OUT/premium-a/$(basename "$f")"; done
for f in "$SRC"/premium/unit-b-2026-10-20/*.jpg; do grade "$f" "$OUT/premium-b/$(basename "$f")"; done
for f in "$SRC"/vortex-building/*.jpg; do grade "$f" "$OUT/building/$(basename "$f")"; done
cp "$SRC/vortex-building/PHOTO-CREDITS.txt" "$OUT/building/"
