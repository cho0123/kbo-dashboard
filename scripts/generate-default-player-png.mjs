/**
 * One-off: writes public/players/default_player.png (210×262, solid #cccccc).
 * Run: node scripts/generate-default-player-png.mjs
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "players", "default_player.png");

const W = 210;
const H = 262;
const BG = [0xcc, 0xcc, 0xcc];

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcSrc = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcSrc), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePngRgb(w, h, rgbFn) {
  const bpp = 3;
  const rowLen = 1 + w * bpp;
  const raw = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    const off = y * rowLen;
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbFn(x, y);
      const p = off + 1 + x * bpp;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), iend]);
}

const png = writePngRgb(W, H, () => BG);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log("Wrote", OUT, png.length, "bytes");
