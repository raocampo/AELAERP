/**
 * Genera los PNG placeholder para assets de Expo.
 * Uso: node scripts/generate-assets.js
 * No requiere dependencias externas — solo Node.js built-ins.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 para PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(typeAndData));
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function createPNG(width, height, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  // Pixel data: 1 filter byte per row + 3 bytes per pixel (RGB)
  const rowLen = 1 + width * 3;
  const raw = Buffer.allocUnsafe(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[y * rowLen + 1 + x * 3] = r;
      raw[y * rowLen + 2 + x * 3] = g;
      raw[y * rowLen + 3 + x * 3] = b;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 1 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// Azul AELA: #1e40af = RGB(30, 64, 175)
const BLUE_R = 30, BLUE_G = 64, BLUE_B = 175;

const assets = [
  { file: 'icon.png',          size: 1024 },
  { file: 'adaptive-icon.png', size: 1024 },
  { file: 'splash-icon.png',   size: 512  },
];

for (const { file, size } of assets) {
  const dest = path.join(assetsDir, file);
  if (fs.existsSync(dest)) {
    console.log(`  ✓ ${file} ya existe — omitido`);
    continue;
  }
  process.stdout.write(`  Generando ${file} (${size}x${size})...`);
  const png = createPNG(size, size, BLUE_R, BLUE_G, BLUE_B);
  fs.writeFileSync(dest, png);
  console.log(` OK (${(png.length / 1024).toFixed(1)} KB)`);
}

console.log('\nAssets listos. Puedes reemplazarlos por imágenes reales en mobile/assets/');
