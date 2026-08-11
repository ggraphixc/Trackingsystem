/**
 * Generates desktop/assets/tracknaija.png — a 64x64 shield in brand colors,
 * drawn pixel-by-pixel and encoded as a real PNG with Node's zlib.
 * No image libraries required.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 64;
const PRIMARY = [37, 99, 235]; // #2563EB
const PRIMARY_DARK = [29, 78, 216]; // #1D4ED8
const ACCENT = [249, 115, 22]; // #F97316
const WHITE = [255, 255, 255];

function isShield(x, y) {
  // Simple shield outline math: wide top, tapered bottom, rounded-ish.
  const nx = (x - SIZE / 2) / (SIZE / 2);
  const ny = (y - SIZE / 2) / (SIZE / 2);
  const topHalf = ny <= 0.05;
  const body = Math.abs(nx) <= 0.95 && ny >= -0.95 && ny <= 0.62;
  const taper = Math.abs(nx) <= 0.72 - Math.max(0, ny - 0.25) * 0.55;
  const topRound = !(ny < -0.62 && Math.abs(nx) > 0.62);
  return (topHalf || body) && taper && topRound;
}

function isCheckMark(x, y) {
  // Rough white check: two strokes inside the shield.
  const nx = (x - SIZE / 2) / (SIZE / 2);
  const ny = (y - SIZE / 2) / (SIZE / 2);
  const stroke1 = ny > 0.02 && ny < 0.16 && nx > -0.42 && nx < -0.08 && Math.abs((ny - 0.09) - 0.65 * (nx + 0.42)) < 0.05;
  const stroke2 = ny > -0.28 && ny < -0.08 && nx > 0.02 && nx < 0.38 && Math.abs((ny + 0.18) - 0.9 * (0.38 - nx)) < 0.06;
  return stroke1 || stroke2;
}

function pixel(x, y) {
  if (!isShield(x, y)) return [0, 0, 0, 0]; // transparent
  if (isCheckMark(x, y)) return [...WHITE, 255];
  const gradient = (y / SIZE) * 0.35 + (x / SIZE) * 0.12;
  const c = [
    Math.round(PRIMARY[0] * (1 - gradient) + PRIMARY_DARK[0] * gradient),
    Math.round(PRIMARY[1] * (1 - gradient) + PRIMARY_DARK[1] * gradient),
    Math.round(PRIMARY[2] * (1 - gradient) + PRIMARY_DARK[2] * gradient),
  ];
  // Orange accent pin at the top-right corner of the shield.
  if (y < 10 && x > SIZE - 12 && x > SIZE - 8) return [...ACCENT, 255];
  return [...c, 255];
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
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

// Raw RGBA scanlines with filter byte 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y);
    const o = rowStart + 1 + x * 4;
    raw[o] = r;
    raw[o + 1] = g;
    raw[o + 2] = b;
    raw[o + 3] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "tracknaija.png"), png);
console.log("Generated assets/tracknaija.png (" + png.length + " bytes)");
