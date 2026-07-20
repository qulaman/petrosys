// Генерация PWA-иконок и favicon из фирменного треугольника WAG (logo/badge-mono.svg).
// Запуск: node scripts/gen-icons.mjs → public/icon-{192,512,maskable}.png, src/app/icon.png
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("c:/WAG/PetroSys/package.json");
const sharp = require("sharp");

const BRAND = "#c2410c"; // primary светлой темы
// Путь монограммы «WA» — из фирменного logo/badge-mono.svg (viewBox 719.49×635.66).
const MONO_PATH = readFileSync("logo/badge-mono.svg", "utf8").match(/ d="([^"]+)"/)[1];
const VB_W = 719.49;
const VB_H = 635.66;

/** Монограмма в белом на оранжевой плашке. pad — доля поля вокруг знака (maskable требует больше). */
function svg(size, pad, radius) {
  const inner = size * (1 - 2 * pad);
  const s = inner / VB_W;
  const offX = size * pad;
  const offY = (size - VB_H * s) / 2; // вертикальное центрирование (знак шире, чем выше)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND}"/>
  <g transform="translate(${offX},${offY}) scale(${s})">
    <path fill="#ffffff" d="${MONO_PATH}"/>
  </g>
</svg>`;
}

async function png(svgStr, out) {
  const buf = await sharp(Buffer.from(svgStr)).png().toBuffer();
  writeFileSync(out, buf);
  console.log("✓", out);
}

/** favicon.ico: ICO-контейнер с PNG-вложениями (16/32/48) — вкладка браузера. */
async function ico(sizes, out) {
  const images = [];
  for (const size of sizes) {
    // Меньше поля и скругления — знак читаем даже в 16 px.
    images.push({ size, buf: await sharp(Buffer.from(svg(size, 0.1, Math.round(size * 0.16)))).png().toBuffer() });
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // палитра
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]));
  console.log("✓", out);
}

await png(svg(192, 0.18, 36), "public/icon-192.png");
await png(svg(512, 0.18, 96), "public/icon-512.png");
await png(svg(512, 0.26, 0), "public/icon-maskable.png"); // maskable: полная заливка, знак в безопасной зоне
await png(svg(256, 0.18, 48), "src/app/icon.png"); // современные браузеры: <link rel="icon">
await ico([16, 32, 48], "src/app/favicon.ico"); // классический /favicon.ico для вкладки
console.log("Готово.");
