#!/usr/bin/env node
// Greps apps/ and packages/ source for forbidden patterns; exits 1 with file:line hits. Allow-list: tokens.css (colours), RichHtml.tsx + JsonLd.tsx (dangerouslySetInnerHTML), *.md, headers/comments are NOT exempt (keep examples in prose without the literal utility).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
const ROOT = resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "../..");
const RULES = [
  { re: /\b(ml|mr|pl|pr|left|right|text-left|text-right)-(\d|\[|auto|px)/, why: "physical direction utility (use ms/me/ps/pe/start/end)", ext: [".tsx", ".ts", ".css"] },
  { re: /(^|[^-\w])(left|right)\s*:/, why: "physical CSS property (use inset-inline-*)", ext: [".css", ".tsx"] },
  // (?<![&\w]) so an HTML numeric entity ("&#160;") is not read as a three-digit colour.
  { re: /(?<![&\w])#(?:[0-9a-fA-F]{3}){1,2}\b/, why: "raw colour outside tokens.css", ext: [".tsx", ".ts", ".css"], allow: [/tokens\.css$/, /tokens\.json$/, /contrast-check\.mjs$/, /og-card\.ts$/, /wordmark\.svg$/] },
  { re: /\brounded-(?!none\b|full\b)/, why: "radius other than 0/pill", ext: [".tsx"] },
  { re: /\bshadow-(?!sheet\b|pop\b|none\b)/, why: "shadow utility (only shadow-sheet/shadow-pop)", ext: [".tsx"] },
  { re: /dangerouslySetInnerHTML/, why: "HTML sink outside RichHtml/JsonLd", ext: [".tsx"], allow: [/RichHtml\.tsx$/, /JsonLd\.tsx$/] },
  { re: /["']use server["']/, why: "Server Actions are forbidden", ext: [".ts", ".tsx"] },
  { re: /\.toLocaleString\(|\.toFixed\(/, why: "use core Persian formatters", ext: [".tsx"] },
  { re: /Math\.random\(\)/, why: "use crypto for ids/tokens", ext: [".ts", ".tsx"], allow: [/__tests__/] },
  { re: /https?:\/\/(fonts\.googleapis|cdn\.|unpkg|jsdelivr|googletagmanager|google-analytics)/, why: "third-party origin", ext: [".ts", ".tsx", ".css"] },
];
function walk(dir, out) { for (const e of readdirSync(dir)) { if (["node_modules", "dist", "__screenshots__"].includes(e) || e.startsWith(".next")) continue; const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) walk(p, out); else out.push(p); } return out; }
const GLOBAL_ALLOW = [/__tests__/, /layout.tsx$/, /manifest.ts$/]; // test fixtures; theme-color meta + manifest colours mirror tokens
let hits = 0;
for (const root of ["apps", "packages"].map((d) => resolve(ROOT, d))) {
  for (const f of walk(root, [])) {
    for (const rule of RULES) {
      if (!rule.ext.some((x) => f.endsWith(x))) continue;
      if (rule.allow?.some((a) => a.test(f)) || GLOBAL_ALLOW.some((a) => a.test(f))) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => { if (rule.re.test(l) && !/@spec|^\s*\*|^\s*\/\//.test(l)) { hits++; console.log(`${relative(ROOT, f).replaceAll("\\", "/")}:${i + 1}: ${rule.why}`); } });
    }
  }
}
console.log(hits ? `\n${hits} forbidden pattern(s)` : "no forbidden patterns");
process.exit(hits ? 1 : 0);
