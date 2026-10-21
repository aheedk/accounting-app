// One-off placeholder icon generator — no image library in this
// environment, so this hand-rolls minimal PNGs (navy background + a white
// "AC" block-letter mark) via Node's built-in zlib, matching the exact
// sizes/alpha the existing assets already have. Run with:
//   node scripts/generate-placeholder-icons.mjs
// Swap these files for the real logo when design delivers it — nothing
// else in app.json needs to change, the filenames stay the same.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'images');

const NAVY = [0x15, 0x1d, 0x33]; // theme.app.sidebar
const WHITE = [0xff, 0xff, 0xff];

// 5x7 block-letter bitmap font, just the two glyphs this needs.
const GLYPHS = {
  A: [
    '01110',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001',
  ],
  C: [
    '01111',
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '01111',
  ],
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** @param {(x:number,y:number)=>[number,number,number,number]} pixelAt */
function encodePng(width, height, pixelAt) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset++] = r; raw[offset++] = g; raw[offset++] = b; raw[offset++] = a;
    }
  }
  const idat = deflateSync(raw);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Renders "AC" centered in a square canvas, scaled to fill most of it. */
function markPixelAt(size, { bg, fg, transparentBg = false }) {
  const letters = ['A', 'C'];
  const glyphW = 5, glyphH = 7, gap = 1;
  const totalCols = glyphW * letters.length + gap;
  const scale = Math.floor((size * 0.62) / totalCols);
  const markW = totalCols * scale;
  const markH = glyphH * scale;
  const startX = Math.floor((size - markW) / 2);
  const startY = Math.floor((size - markH) / 2);

  return (x, y) => {
    const relX = x - startX, relY = y - startY;
    if (relX >= 0 && relX < markW && relY >= 0 && relY < markH) {
      const col = Math.floor(relX / scale);
      const row = Math.floor(relY / scale);
      // col: [0,5)=A, 5=gap, [6,11)=C — hardcoded for the 2-letter "AC" mark.
      let letter = null, localCol = 0;
      if (col < glyphW) { letter = 'A'; localCol = col; }
      else if (col >= glyphW + gap) { letter = 'C'; localCol = col - glyphW - gap; }
      if (letter && localCol < glyphW && GLYPHS[letter][row]?.[localCol] === '1') {
        return [...fg, 255];
      }
    }
    return transparentBg ? [0, 0, 0, 0] : [...bg, 255];
  };
}

function writeIcon(name, size, opts) {
  const png = encodePng(size, size, markPixelAt(size, opts));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote ${name} (${size}x${size})`);
}

function writeSolid(name, size, color) {
  const png = encodePng(size, size, () => [...color, 255]);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote ${name} (${size}x${size}, solid)`);
}

writeIcon('icon.png', 1024, { bg: NAVY, fg: WHITE });
writeIcon('splash-icon.png', 1024, { bg: NAVY, fg: WHITE, transparentBg: true });
writeIcon('favicon.png', 48, { bg: NAVY, fg: WHITE });
writeIcon('android-icon-foreground.png', 512, { bg: NAVY, fg: WHITE, transparentBg: true });
writeIcon('android-icon-monochrome.png', 432, { bg: NAVY, fg: WHITE, transparentBg: true });
writeSolid('android-icon-background.png', 512, NAVY);

console.log('Done. These are placeholders — swap in the real logo when design delivers it.');
