#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const input = process.argv[2] ?? path.join(ROOT, "apps/web/public/brand/brand-20260831/logo-name.png");
const output = process.argv[3] ?? path.join(path.dirname(input), "logo-name-alpha.png");

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(data.length);
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const a = Math.max(r, g, b);
  if (a === 0) {
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    continue;
  }
  // un-premultiply against black: colour = pixel / alpha (clamped)
  out[i] = Math.min(255, Math.round((r * 255) / a));
  out[i + 1] = Math.min(255, Math.round((g * 255) / a));
  out[i + 2] = Math.min(255, Math.round((b * 255) / a));
  out[i + 3] = a;
}
await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(output);
console.log(`wrote ${path.relative(ROOT, output)} (${info.width}×${info.height})`);
