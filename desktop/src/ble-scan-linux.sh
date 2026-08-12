#!/usr/bin/env bash
# Dravex BLE scanner (Linux/BlueZ) — best-effort community finder.
#
# Uses `btmon` (the BlueZ monitor) to dump raw HCI traffic for N seconds,
# then looks for our 16-bit service UUID 0xFFFA followed by the beacon
# payload [0x01] + 12 ASCII hex chars. Prints one JSON array of
# {"beacon": "...", "rssi": null} to stdout.
#
# Requires: btmon on PATH and permission to capture HCI (root or the
# `bluetooth` group). Without btmon we print [] and exit 1 so the UI can
# show an honest "unsupported" reason.
#
# Usage: ble-scan-linux.sh <seconds>

set -u
DUR=${1:-10}

if ! command -v btmon >/dev/null 2>&1; then
  echo "[]"
  exit 1
fi

OUT=$(timeout "${DUR}s" btmon 2>/dev/null || true)

OUT="$OUT" python3 - <<'PY'
import json, os, re

blob = os.environ.get("OUT", "").upper()
beacons, seen = [], set()
# btmon dumps advertisement data as space-separated hex bytes, e.g.:
#   02 01 06 03 03 FA FF 09 09 44 72 61 76 65 78 16 16 FA FF 01 30 31 32 33 ...
# The 16-bit Service Data record (type 0x16) carries our UUID (FA FF little
# endian) then [0x01] + 12 ASCII hex chars. The beacon id is transmitted as
# 12 ASCII characters, so in the byte dump it appears as 24 hex digits
# (e.g. "30 31 32..." == "012"). Capture the full 24 and decode each byte
# pair back to ASCII — a raw 12-hex capture would yield the hex-of-the-ASCII
# and never match the ids the server/Android/Windows scanners use.
for m in re.finditer(r"FA FF 01 ([0-9A-F]{24})", blob):
    raw = m.group(1)
    beacon = "".join(chr(int(raw[i:i + 2], 16)) for i in range(0, 24, 2)).lower()
    if re.fullmatch(r"[0-9a-f]{12}", beacon) and beacon not in seen:
        seen.add(beacon)
        beacons.append({"beacon": beacon, "rssi": None})
print(json.dumps(beacons, separators=(",", ":")))
PY
