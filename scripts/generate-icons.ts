import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "public");

// Three rising bars — the same home/draw/away motif the odds rows use — over a dark tile.
function markSvg({ size, padding }: { size: number; padding: number }): string {
  const inner = size - padding * 2;
  const barWidth = inner * 0.2;
  const gap = (inner - barWidth * 3) / 2;
  const radius = barWidth / 2;
  const heights = [0.42, 0.68, 1];

  const bars = heights
    .map((h, i) => {
      const barHeight = inner * h;
      const x = padding + i * (barWidth + gap);
      const y = padding + inner - barHeight;
      const fill = ["#2FD98F", "#F2B44C", "#7C6BFF"][i];
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${fill}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0B0C0E"/>
  ${bars}
</svg>`;
}

function roundedSvg({ size, padding }: { size: number; padding: number }): string {
  const inner = size - padding * 2;
  const barWidth = inner * 0.2;
  const gap = (inner - barWidth * 3) / 2;
  const radius = barWidth / 2;
  const heights = [0.42, 0.68, 1];

  const bars = heights
    .map((h, i) => {
      const barHeight = inner * h;
      const x = padding + i * (barWidth + gap);
      const y = padding + inner - barHeight;
      const fill = ["#2FD98F", "#F2B44C", "#7C6BFF"][i];
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${fill}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${(size * 0.22).toFixed(2)}" fill="#0B0C0E"/>
  <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${(size * 0.22).toFixed(2)}" fill="none" stroke="#232427" stroke-width="2"/>
  ${bars}
</svg>`;
}

async function png(svg: string, size: number, file: string) {
  const buffer = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(path.join(OUT_DIR, file), buffer);
  console.log(`  ${file} (${size}x${size})`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log("Generating app icons:");

  // Standard icons keep the rounded tile; the maskable one is full-bleed with a safe inset
  // so platform masks (circle, squircle) never clip the mark.
  await png(roundedSvg({ size: 512, padding: 512 * 0.26 }), 192, "icon-192.png");
  await png(roundedSvg({ size: 512, padding: 512 * 0.26 }), 512, "icon-512.png");
  await png(markSvg({ size: 512, padding: 512 * 0.3 }), 512, "icon-maskable-512.png");
  await png(roundedSvg({ size: 512, padding: 512 * 0.26 }), 180, "apple-touch-icon.png");
  await png(roundedSvg({ size: 512, padding: 512 * 0.24 }), 32, "favicon.png");

  await writeFile(path.join(OUT_DIR, "icon.svg"), roundedSvg({ size: 512, padding: 512 * 0.26 }));
  console.log("  icon.svg");
}

main();
