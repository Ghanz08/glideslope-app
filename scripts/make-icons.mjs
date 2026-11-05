// PLACEHOLDER icons (section 4.12): monogram of APP_NAME's first letter on the accent colour. Replace with a real logo later.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const ACCENT = [0x2d, 0x5b, 0xd6];
const GLYPHS = {
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
};
const letter = (process.env.APP_NAME || "Glideslope")[0].toUpperCase();
const glyph = GLYPHS[letter] ?? GLYPHS.G;

function crc(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  c = 0xffffffff;
  for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size, safe) {
  const scale = Math.floor((size * (safe ? 0.5 : 0.62)) / 7);
  const w = 5 * scale, h = 7 * scale, ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - ox) / scale), gy = Math.floor((y - oy) / scale);
      const on = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && glyph[gy][gx] === "1";
      const [r, g, b] = on ? [255, 255, 255] : ACCENT;
      row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size, safe] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true]]) writeFileSync(`public/${name}`, png(size, safe));
console.log("ikon placeholder dibuat di public/");
