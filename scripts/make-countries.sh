#!/usr/bin/env bash
# Generate a simplified countries GeoJSON from Natural Earth (admin-0, 1:50m)
# Output: map/countries.geojson
# Requirements: curl, unzip, Node (for npx mapshaper)
# Usage (from repo root):
#   bash scripts/make-countries.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$ROOT/map/tmp"
OUT="$ROOT/map/countries.geojson"
ZIP="$TMP/ne_50m_admin_0_countries.zip"
SRC_URL="https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"

mkdir -p "$TMP" "$ROOT/map"

echo "[*] Downloading Natural Earth (50m) countries…"
curl -L --fail -o "$ZIP" "$SRC_URL"

echo "[*] Unzipping…"
unzip -o "$ZIP" -d "$TMP" >/dev/null

# Locate the shapefile (path may include a version suffix)
SHP="$(ls "$TMP"/*_admin_0_countries.shp | head -n 1)"
if [[ -z "${SHP:-}" ]]; then
  echo "[x] Could not find *_admin_0_countries.shp in $TMP" >&2
  exit 1
fi

echo "[*] Simplifying and exporting GeoJSON…"
# - simplify to ~8% with weighted algorithm, keep shapes from collapsing
# - pick a stable NAME field (prefer NAME_EN > NAME > ADMIN)
# - keep a small set of useful props; rename NAME_FINAL -> NAME
npx -y mapshaper "$SHP" \
  -simplify weighted 8% keep-shapes \
  -each 'NAME_FINAL = NAME_EN ? NAME_EN : (NAME ? NAME : ADMIN)' \
  -filter-fields NAME_FINAL,ADMIN,SOVEREIGNT,ISO_A3,ISO_A2 \
  -rename-fields NAME=NAME_FINAL \
  -o format=geojson "$OUT"

# Pretty size print (numfmt if available)
SIZE_BYTES=$(wc -c < "$OUT")
if command -v numfmt >/dev/null 2>&1; then
  SIZE_H="$(numfmt --to=iec --suffix=B "$SIZE_BYTES")"
else
  SIZE_H="$SIZE_BYTES bytes"
fi

echo "[✓] Wrote $OUT ($SIZE_H)"
echo "[i] Tip: in your map code, match countries by Feature.properties.NAME, falling back to ADMIN if needed."