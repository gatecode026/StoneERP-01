// Generates simple PNG icons (terracotta square with a stacked-slab mark). Run: node scripts/make-icons.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [181, 101, 29], fg = [245, 239, 230], mid = [234, 223, 207];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let c = bg;
      // three stacked slabs
      const slab = (top, h, l, r) => v >= top && v < top + h && u >= l && u < r;
      if (slab(0.28, 0.14, 0.2, 0.8)) c = fg;
      else if (slab(0.46, 0.14, 0.26, 0.74)) c = mid;
      else if (slab(0.64, 0.14, 0.2, 0.8)) c = fg;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const out = path.join(__dirname, '..', 'public');
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512));
console.log('icons written');
