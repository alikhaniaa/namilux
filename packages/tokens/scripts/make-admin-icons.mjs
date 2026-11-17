#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sharp = createRequire(resolve(root, "packages/seed/package.json"))("sharp");
const tokens = JSON.parse(await readFile(resolve(root, "packages/tokens/tokens.json"), "utf8"));

export const VERSION = "admin-20260907";
const ground = tokens.themes.light.accent;
// The panel's mark is the storefront's monochrome silhouette on accent, so it follows the badge:
// whichever folder make-owner-brand.mjs last built is the one read here.
const mono = resolve(root, "apps/web/public/icons", tokens.brand.icons, "mono-512.png");
const out = resolve(root, "apps/admin/public/icons", VERSION);
const png = { compressionLevel: 9, palette: false };

async function icon(size, ratio) {
  const side = Math.round(size * ratio);
  const art = await sharp(mono).resize({ width: side, height: side, fit: "inside" }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: ground } })
    .composite([{ input: art, gravity: "centre" }])
    .png(png)
    .toBuffer();
}

const FILES = [
  ["icon-192.png", 192, 0.72],
  ["icon-512.png", 512, 0.72],
  ["maskable-512.png", 512, 0.5],
  ["apple-touch-icon.png", 180, 0.7],
  ["sc-orders.png", 96, 0.72],
  ["favicon-32.png", 32, 0.86],
];

await mkdir(out, { recursive: true });
for (const [file, size, ratio] of FILES) await writeFile(resolve(out, file), await icon(size, ratio));
await writeFile(resolve(out, "mono-512.png"), await readFile(mono));

// validation
for (const [file, size] of FILES) {
  const meta = await sharp(resolve(out, file)).metadata();
  if (meta.width !== size || meta.height !== size) throw new Error(`wrong size: ${file}`);
}
const mask = await sharp(resolve(out, "maskable-512.png")).raw().toBuffer({ resolveWithObject: true });
const g = mask.data.subarray(0, 3);
for (let y = 0; y < 512; y += 1) {
  for (let x = 0; x < 512; x += 1) {
    if (x >= 102 && x < 410 && y >= 102 && y < 410) continue;
    const p = (y * 512 + x) * mask.info.channels;
    if (!mask.data.subarray(p, p + 3).equals(g)) throw new Error("maskable artwork leaves the safe box");
  }
}
const monoStats = await sharp(resolve(out, "mono-512.png")).stats();
if (monoStats.channels.length < 4 || monoStats.channels[3].min !== 0) throw new Error("mono icon lost its alpha");

// Same contract as the storefront's build: the version the panel reads moves only once the files
// behind it exist. See the note on tokens.json `brand`.
const tokensPath = resolve(root, "packages/tokens/tokens.json");
const before = await readFile(tokensPath, "utf8");
let brand = false;
const after = before
  .split("\n")
  .map((line) => {
    if (line.trimStart().startsWith('"brand"')) brand = true;
    else if (brand && line.trimStart().startsWith("}")) brand = false;
    const key = brand ? line.match(/^(\s*)"admin":\s*"[^"]*"(,?)$/) : null;
    return key === null ? line : `${key[1]}"admin": "${VERSION}"${key[2]}`;
  })
  .join("\n");
if (JSON.parse(after).brand.admin !== VERSION) throw new Error("could not update tokens.json brand.admin");
if (after !== before) await writeFile(tokensPath, after);

process.stdout.write(`${JSON.stringify({ version: VERSION, ground, files: FILES.length + 1, validated: true })}\n`);
