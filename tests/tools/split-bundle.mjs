#!/usr/bin/env node
// Splits a scaffold bundle into files. Bundle format: lines "===== <repo-relative path> =====" start a file;
// everything until the next marker is its content. Usage: node tests/tools/split-bundle.mjs <bundle.txt> [--dry]
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
const [, , bundle, flag] = process.argv;
const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const text = readFileSync(bundle, "utf8");
const parts = text.split(/^===== (.+?) =====\r?\n/m);
let n = 0, skipped = 0;
for (let i = 1; i < parts.length; i += 2) {
  const rel = parts[i].trim(), body = parts[i + 1].replace(/\s+$/, "") + "\n";
  const abs = resolve(root, rel);
  if (existsSync(abs) && !process.env.OVERWRITE) { skipped++; console.log("skip (exists):", rel); continue; }
  if (flag !== "--dry") { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body, "utf8"); }
  n++;
}
console.log(`${flag === "--dry" ? "would write" : "wrote"} ${n} files, skipped ${skipped}`);
