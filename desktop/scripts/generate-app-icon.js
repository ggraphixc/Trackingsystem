/**
 * TrackNaija app icon generator — pure Node, no image libraries.
 *
 * Design: rounded-square blue gradient tile with a white location pin
 * (orange head) and two radar arcs — the "tracking" story at a glance.
 * Outputs:
 *   build/icon.png         512x512 — electron-builder converts this to
 *                                   .ico (Windows) / .icns (macOS) /
 *                                   .png (Linux) automatically.
 *   assets/tracknaija.png   64x64  — the in-app window + tray icon.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 512;
const PRIMARY = [37, 99, 235]; // #2563EB
const PRIMARY_DARK = [29, 78, 216]; // #1D4ED8
const ACCENT = [249, 115, 22]; // #F97316
const WHITE = [255, 255, 255];

const CX = SIZE / 2;
const CY = SIZE / 2;

/** Rounded-square tile, leaving a slim margin. */
function inTile(x, y) {
  const hw = 0.5 * SIZE - 8;
  const hh = 0.5 * SIZE - 8;
  const r = 0.19 * SIZE;
  const dx = Math.abs(x - CX);
  const dy = Math.abs(y - CY);
  if (dx > hw || dy > hh) return false;
  if (dx <= hw - r || dy <= hh - r) return true;
  const ox = dx - (hw - r);
  const oy = dy - (hh - r);
  return ox * ox + oy * oy <= r * r;
}

/** Radar arc: ring of radius `r`, stroke `w`, visible on an angular sweep. */
function inArcRing(x, y, r, w) {
  const dx = x - CX;
  const dy = y - CY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(dist - r) > w / 2) return false;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = east, 90 = north
  return ang >= -135 && ang <= 55;
}

function inCircle(x, y, rcx, rcy, r) {
  const dx = x - rcx;
  const dy = y - rcy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx2, cy2) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx2) * (by - cy2) - (bx - cx2) * (py - cy2);
  const d3 = (px - ax) * (cy2 - ay) - (cx2 - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** The white location pin (head circle + tapering tail to a point). */
function inPin(x, y) {
  const headCy = CY - 0.03 * SIZE;
  const headR = 0.115 * SIZE;
  if (inCircle(x, y, CX, headCy, headR)) return true;
  // Tail triangle: from the head's lower rim down to a point.
  const tx = 0.95 * headR * Math.cos(Math.PI / 4);
  const ty = 0.95 * headR * Math.sin(Math.PI / 4);
  return inTriangle(
    x, y,
    CX - tx, headCy + ty, // left edge of head rim
    CX + tx, headCy + ty, // right edge of head rim
    CX, headCy + 0.30 * SIZE, // the point
  );
}

function blend(bg, fg, alpha) {
  const a = alpha / 255;
  // Keep the background's alpha channel: blend() must always return RGBA.
  const bgA = bg[3] === undefined ? 255 : bg[3];
  return [
    Math.round(bg[0] * (1 - a) + fg[0] * a),
    Math.round(bg[1] * (1 - a) + fg[1] * a),
    Math.round(bg[2] * (1 - a) + fg[2] * a),
    bgA,
  ];
}

/** RGBA for one pixel (2x2 supersampled for anti-aliasing). */
function pixel(x, y) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const px = x + (sx + 0.5) / 2;
      const py = y + (sy + 0.5) / 2;
      const [cr, cg, cb, ca] = shade(px, py);
      r += cr * ca;
      g += cg * ca;
      b += cb * ca;
      a += ca;
    }
  }
  const n = a || 1;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / 4)];
}

function shade(x, y) {
  if (!inTile(x, y)) return [0, 0, 0, 0];

  // Diagonal blue gradient + subtle darkening toward the bottom edge.
  const t = (x / SIZE) * 0.14 + (y / SIZE) * 0.42;
  const edge = Math.max(0, (y - CX) / CX);
  const tint = t + edge * edge * 0.5;
  const c = [
    Math.round(PRIMARY[0] * (1 - tint) + PRIMARY_DARK[0] * tint),
    Math.round(PRIMARY[1] * (1 - tint) + PRIMARY_DARK[1] * tint),
    Math.round(PRIMARY[2] * (1 - tint) + PRIMARY_DARK[2] * tint),
  ];

  // Radar arcs behind the pin (white strokes ONLY where the arcs are —
  // never wash the whole tile).
  let out = [...c, 255];
  if (inArcRing(x, y, 0.30 * SIZE, 0.055 * SIZE)) out = blend(out, WHITE, 170);
  if (inArcRing(x, y, 0.185 * SIZE, 0.055 * SIZE)) out = blend(out, WHITE, 145);

  // Location pin + orange head.
  if (inPin(x, y)) out = blend(out, WHITE, 255);
  if (inCircle(x, y, CX, CY - 0.03 * SIZE, 0.05 * SIZE)) out = blend(out, ACCENT, 255);
  return out;
}

/* ---------------- PNG encoding (reused from generate-icon.js) ---------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 4;
      const i = (y * size + x) * 4;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
      raw[o + 3] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- render 512 ---------------- */

console.log("Rendering " + SIZE + "x" + SIZE + " icon…");
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y);
    const o = (y * SIZE + x) * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = a;
  }
}

const png512 = encodePng(SIZE, rgba);
const buildDir = path.join(__dirname, "..", "build");
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, "icon.png"), png512);
console.log("Wrote build/icon.png (" + png512.length + " bytes)");

/* ---------------- downsample to 64 for tray/window ---------------- */

const S64 = 64;
const K = SIZE / S64; // 8
const rgba64 = Buffer.alloc(S64 * S64 * 4);
for (let y = 0; y < S64; y++) {
  for (let x = 0; x < S64; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < K; sy++) {
      for (let sx = 0; sx < K; sx++) {
        const o = ((y * K + sy) * SIZE + (x * K + sx)) * 4;
        r += rgba[o] * rgba[o + 3];
        g += rgba[o + 1] * rgba[o + 3];
        b += rgba[o + 2] * rgba[o + 3];
        a += rgba[o + 3];
      }
    }
    const n = a || 1;
    const o64 = (y * S64 + x) * 4;
    rgba64[o64] = Math.round(r / n);
    rgba64[o64 + 1] = Math.round(g / n);
    rgba64[o64 + 2] = Math.round(b / n);
    rgba64[o64 + 3] = Math.round(a / (K * K));
  }
}
const png64 = encodePng(S64, rgba64);
const assetsDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(path.join(assetsDir, "tracknaija.png"), png64);
console.log("Wrote assets/tracknaija.png (" + png64.length + " bytes)");
