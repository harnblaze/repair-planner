// Генерирует иконки PWA в public/icons/ из логотипа шапки (синий квадрат
// с календарём, components/common/icons.tsx → CalendarIcon).
// Запуск: node scripts/generate-pwa-icons.mjs — результат коммитится.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const BRAND = "#2f55c8";
const OUT = join(process.cwd(), "public", "icons");

// Глиф CalendarIcon во viewBox 16×16; центр рисунка ≈ (8, 7.75).
const GLYPH = `<rect x="2" y="3.2" width="12" height="10.5" rx="1.6"/><path d="M2 6.4h12M5.4 1.8v2.6M10.6 1.8v2.6"/>`;

/** scale — размер одной единицы глифа в px при холсте 512; radius — скругление фона. */
function svg({ scale, radius }) {
  const tx = 256 - 8 * scale;
  const ty = 256 - 7.75 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${BRAND}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>
</svg>`;
}

// Обычная иконка — скруглённый квадрат, как логотип в шапке.
const regular = svg({ scale: 24, radius: 112 });
// Maskable: фон во весь квадрат (ОС сама обрежет форму), глиф меньше,
// чтобы уместиться в безопасную зону (центральный круг 80%).
const maskable = svg({ scale: 17, radius: 0 });
// iOS только скругляет углы — глиф можно крупнее.
const apple = svg({ scale: 21, radius: 0 });

const targets = [
  { file: "icon-192.png", size: 192, source: regular },
  { file: "icon-512.png", size: 512, source: regular },
  { file: "icon-maskable-512.png", size: 512, source: maskable },
  { file: "apple-touch-icon.png", size: 180, source: apple },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, source } of targets) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(join(OUT, file));
  console.log(`public/icons/${file}`);
}
