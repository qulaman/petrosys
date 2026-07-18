// Генерация PWA-иконок и favicon из знака Arlan Ops (треугольник-уступы).
// Запуск: node scripts/gen-icons.mjs → public/icon-{192,512,maskable}.png, src/app/icon.png
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire("c:/WAG/PetroSys/package.json");
const sharp = require("sharp");

const BRAND = "#c2410c"; // primary светлой темы

/** Знак в белом на оранжевой плашке. pad — доля поля вокруг знака (maskable требует больше). */
function svg(size, pad, radius) {
  const inner = size * (1 - 2 * pad);
  const off = size * pad;
  const s = inner / 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND}"/>
  <g transform="translate(${off},${off}) scale(${s})" fill="#ffffff">
    <path d="M17.1 65 H78.9 L92 90 H4 Z"/>
    <path d="M30.7 39 H65.3 L76.3 60 H19.7 Z"/>
    <path d="M48 6 L62.7 34 H33.3 Z"/>
  </g>
</svg>`;
}

async function png(svgStr, out) {
  const buf = await sharp(Buffer.from(svgStr)).png().toBuffer();
  writeFileSync(out, buf);
  console.log("✓", out);
}

await png(svg(192, 0.18, 36), "public/icon-192.png");
await png(svg(512, 0.18, 96), "public/icon-512.png");
await png(svg(512, 0.26, 0), "public/icon-maskable.png"); // maskable: полная заливка, знак в безопасной зоне
await png(svg(256, 0.18, 48), "src/app/icon.png"); // favicon (Next отдаёт /icon.png)
console.log("Готово.");
