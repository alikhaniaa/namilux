#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** [label, fg, bg, min, note] - checked in both themes. */
export const PAIRS = [
  // -  -  - text on the page grounds -  -  - 
  ["ink on bg", "ink", "bg", 4.5, "body text (doc 16.5 / 16.6)"],
  ["ink on surface", "ink", "surface", 4.5, "cards, sheets, checkout panel"],
  ["ink on bg-soft", "ink", "bg-soft", 4.5, "strips, zebra rows"],
  ["ink-2 on bg", "ink-2", "bg", 4.5, "secondary text (doc 6.9 / 9.0)"],
  ["ink-2 on surface", "ink-2", "surface", 4.5, ""],
  ["ink-2 on bg-soft", "ink-2", "bg-soft", 4.5, ""],
  ["ink-3 on bg", "ink-3", "bg", 4.5, "struck price, captions, counts (doc 5.3 / 5.9)"],
  ["ink-3 on surface", "ink-3", "surface", 4.5, "cart line meta"],
  ["ink-3 on bg-soft", "ink-3", "bg-soft", 4.5, "zebra spec rows, --out badge (doc ≥ 4.9)"],
  ["accent as text on bg", "accent", "bg", 4.5, "pressed chip / tab label (doc 5.4 / 9.4)"],
  ["accent as text on surface", "accent", "surface", 4.5, ""],
  ["accent as text on bg-soft", "accent", "bg-soft", 4.5, ""],
  ["accent on accent-soft", "accent", "accent-soft", 4.5, "pressed chip text on its ground (doc 4.9)"],
  ["ink-2 on accent-soft", "ink-2", "accent-soft", 4.5, "count inside a pressed chip"],
  ["accent-ink on accent", "accent-ink", "accent", 4.5, "primary CTA label (doc 5.8 / 9.4)"],
  ["accent-ink on accent-hover", "accent-ink", "accent-hover", 4.5, "CTA hover"],
  ["bg on ink", "bg", "ink", 4.5, "--sale badge: ink fill, bg text"],
  // -  -  - state colours (labels, dot + text) -  -  - 
  ["ok on bg", "ok", "bg", 4.5, "● موجود (doc ≥ 5.0)"],
  ["ok on surface", "ok", "surface", 4.5, ""],
  ["ok on bg-soft", "ok", "bg-soft", 4.5, ""],
  ["ok on ok-soft", "ok", "ok-soft", 4.5, ""],
  ["warn on bg", "warn", "bg", 4.5, "● ۳ عدد باقی"],
  ["warn on surface", "warn", "surface", 4.5, ""],
  ["warn on bg-soft", "warn", "bg-soft", 4.5, ""],
  ["warn on warn-soft", "warn", "warn-soft", 4.5, "--last badge"],
  ["danger on bg", "danger", "bg", 4.5, "form errors, ● ناموجود"],
  ["danger on surface", "danger", "surface", 4.5, "field error under an input"],
  ["danger on bg-soft", "danger", "bg-soft", 4.5, ""],
  ["danger on danger-soft", "danger", "danger-soft", 4.5, ""],
  // -  -  - the frame (header, footer, chapters) -  -  - 
  ["frame-ink on frame", "frame-ink", "frame", 4.5, "header/footer text"],
  ["frame-ink-2 on frame", "frame-ink-2", "frame", 4.5, "footer text, nav meta (doc 7.9 / 8.5)"],
  ["frame-accent on frame", "frame-accent", "frame", 4.5, "active nav label (doc 9.0 / 9.8)"],
  ["frame on frame-accent", "frame", "frame-accent", 4.5, "cart badge digits on the pill"],
  ["frame on frame-ink", "frame", "frame-ink", 4.5, "btn--primary on the frame (frame-ink fill)"],
  ["frame-ink on frame-line", "frame-ink", "frame-line", 4.5, "footer well headings"],
  ["frame-ink-2 on frame-line", "frame-ink-2", "frame-line", 4.5, "trust-seals well text"],
  // -  -  - UI v4: the bronze eyebrow -  -  - 
  ["gilt as text on bg", "gilt", "bg", 4.5, "Latin eyebrows, ordinals (UI v4)"],
  ["gilt as text on surface", "gilt", "surface", 4.5, ""],
  ["gilt as text on bg-soft", "gilt", "bg-soft", 4.5, ""],
  ["frame-gilt on frame", "frame-gilt", "frame", 4.5, "hero kicker, marquee dots"],
  ["frame-gilt on frame-line", "frame-gilt", "frame-line", 4.5, ""],
  // -  -  - non-text: borders and focus rings (WCAG 1.4.11) -  -  - 
  ["line-input on bg", "line-input", "bg", 3.0, "input border (doc 3.3 / 3.8)"],
  ["line-input on surface", "line-input", "surface", 3.0, "input border on a card"],
  ["line-input on bg-soft", "line-input", "bg-soft", 3.0, "input border on a strip"],
  ["focus ring accent on bg", "accent", "bg", 3.0, ":focus-visible on the page"],
  ["focus ring accent on surface", "accent", "surface", 3.0, ":focus-visible on a card/sheet"],
  ["focus ring accent on bg-soft", "accent", "bg-soft", 3.0, ":focus-visible on a strip"],
  ["focus ring frame-accent on frame", "frame-accent", "frame", 3.0, ".frame scopes --focus"],
  ["focus ring frame-accent on frame-line", "frame-accent", "frame-line", 3.0, "focus inside the footer well"],
  ["focus ring plate-ink on plate", "plate-ink", "plate", 3.0, ".plate scopes --focus"],
  ["focus ring plate-ink on plate-chip", "plate-ink", "plate-chip", 3.0, "focus on the wishlist chip"],
  ["--new badge ring accent on surface", "accent", "surface", 3.0, "surface badge + accent inset ring"],
  // -  -  - the plate island (identical in both themes) -  -  - 
  ["plate-ink on plate", "plate-ink", "plate", 4.5, "typographic fallback tile (doc 13.9)"],
  ["plate-ink-2 on plate", "plate-ink-2", "plate", 4.5, "kicker on a fallback tile"],
  ["plate-ink on plate-chip", "plate-ink", "plate-chip", 4.5, "badge text on a chip"],
  ["plate-ink-2 on plate-chip", "plate-ink-2", "plate-chip", 4.5, "icon inside the wishlist chip"],
  // -  -  - separation -  -  - 
  ["plate vs bg", "plate", "bg", 1.2, "a tile exists as a region (doc ≥ 1.2 / 14.4)"],
  ["plate-chip vs plate", "plate-chip", "plate", 1.2, "chip separation on the plate"],
  ["surface vs plate", "surface", "plate", 1.2, "--new badge ground on the plate"],
  ["frame-line vs frame", "frame-line", "frame", 1.2, "hairline visible on the frame"],
  ["surface vs bg", "surface", "bg", 1.02, "card lifts off the wall"],
  ["bg-soft vs bg", "bg-soft", "bg", 1.02, "strip separation"],
];

const STATIC_GROUPS = ["shape", "shadow", "easing", "duration", "spacing"];
const PLATE_ISLAND = ["plate-ink", "plate-ink-2", "plate-chip"];
const HEX6 = /^#[0-9A-F]{6}$/u;

// -  -  - maths (WCAG 2.1) -  -  - 
function hexToRgb(h) {
  let s = h.replace("#", "");
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// -  -  - CSS parsing -  -  - 
const squash = (s) => s.replace(/\s+/gu, " ").trim();

/** @param {string} cssText */
export function parseTokensCss(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//gu, "");
  const blocks = {};
  const re = /([^{}]+)\{([^{}]*)\}/gu;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = squash(m[1]);
    const body = m[2];
    const vars = {};
    const vre = /--([\w-]+)\s*:\s*([^;]+);/gu;
    let v;
    while ((v = vre.exec(body)) !== null) vars[v[1]] = squash(v[2]);
    blocks[selector] = { vars, body: squash(body) };
  }
  return {
    root: blocks[":root"]?.vars ?? {},
    dark: blocks["html.dark"]?.vars ?? {},
    plateFrame: blocks[".plate, .frame"]?.vars ?? {},
    frame: blocks[".frame"]?.vars ?? {},
    focusVisible: blocks[":focus-visible"]?.body ?? "",
  };
}

// -  -  - checks -  -  - 
export function run() {
  const tokens = JSON.parse(fs.readFileSync(path.join(HERE, "tokens.json"), "utf8"));
  const css = parseTokensCss(fs.readFileSync(path.join(HERE, "tokens.css"), "utf8"));
  const sync = [];

  // 1. colour format + plate island
  for (const theme of ["light", "dark"]) {
    for (const [k, val] of Object.entries(tokens.themes[theme])) {
      if (!HEX6.test(val)) sync.push(`tokens.json themes.${theme}.${k} is not uppercase #RRGGBB: ${val}`);
    }
  }
  for (const k of PLATE_ISLAND) {
    if (tokens.themes.light[k] !== tokens.themes.dark[k]) sync.push(`plate island token --${k} differs between themes`);
  }

  // 2. css ↔ json values
  for (const [k, val] of Object.entries(tokens.themes.light)) {
    if (css.root[k] !== val) sync.push(`tokens.css :root --${k} = ${css.root[k] ?? "(missing)"}; tokens.json light = ${val}`);
  }
  for (const [k, val] of Object.entries(tokens.themes.dark)) {
    if (css.dark[k] !== val) sync.push(`tokens.css html.dark --${k} = ${css.dark[k] ?? "(missing)"}; tokens.json dark = ${val}`);
  }
  for (const k of Object.keys(css.dark)) {
    if (k !== "focus" && !(k in tokens.themes.dark)) sync.push(`tokens.css html.dark declares --${k}, which is not a colour token`);
  }
  for (const group of STATIC_GROUPS) {
    for (const [k, val] of Object.entries(tokens[group])) {
      if (css.root[k] !== squash(val)) sync.push(`tokens.css :root --${k} = ${css.root[k] ?? "(missing)"}; tokens.json ${group} = ${val}`);
    }
  }
  if (css.root["font-sans"] !== squash(tokens.font["font-sans"])) sync.push("tokens.css :root --font-sans differs from tokens.json font.font-sans");
  if (css.root.focus !== tokens.focus.root) sync.push(":root --focus must be " + tokens.focus.root);
  if (css.dark.focus !== tokens.focus.root) sync.push("html.dark --focus must be " + tokens.focus.root);
  if (css.plateFrame.focus !== tokens.focus.plate) sync.push("`.plate, .frame { --focus }` must be " + tokens.focus.plate);
  if (css.frame.focus !== tokens.focus.frame) sync.push("`.frame { --focus }` must be " + tokens.focus.frame);
  if (!css.focusVisible.includes(`outline: ${tokens.focus.outline}`) || !css.focusVisible.includes(`outline-offset: ${tokens.focus["outline-offset"]}`)) {
    sync.push(":focus-visible must be `outline: 2px solid var(--focus); outline-offset: 2px;`");
  }
  if (tokens.manifest.theme_color !== tokens.themes.light.frame || tokens.manifest.background_color !== tokens.themes.light.frame) {
    sync.push("manifest colours must equal the light frame colour");
  }

  // 3. pairs
  const pairs = [];
  for (const theme of ["light", "dark"]) {
    const t = tokens.themes[theme];
    for (const [label, fg, bg, min, note] of PAIRS) {
      if (!(fg in t) || !(bg in t)) {
        pairs.push({ theme, label, fg, bg, min, value: 0, pass: false, note: "missing token" });
        continue;
      }
      const value = ratio(t[fg], t[bg]);
      pairs.push({ theme, label, fg, bg, min, value, pass: value >= min, note });
    }
  }

  const failures = sync.length + pairs.filter((p) => !p.pass).length;
  return { failures, sync, pairs };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const quiet = args.has("--quiet");
  const result = run();

  if (args.has("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.failures === 0 ? 0 : 1);
  }

  const out = [];
  for (const line of result.sync) out.push(`SYNC FAIL  ${line}`);
  let theme = "";
  for (const p of result.pairs) {
    if (p.theme !== theme) {
      theme = p.theme;
      if (!quiet) out.push("", "=".repeat(78), `  ${theme.toUpperCase()}`, "=".repeat(78));
    }
    if (p.pass && quiet) continue;
    out.push(
      `  ${p.pass ? "ok  " : "FAIL"} ${p.label.padEnd(40)} ${p.value.toFixed(2).padStart(6)}  (min ${String(p.min).padStart(4)})  ${p.note}`,
    );
  }
  const total = result.pairs.length;
  out.push(
    "",
    result.failures === 0
      ? `ok  ${total}/${total} pairs pass in both themes; tokens.css and tokens.json agree.`
      : `FAIL ${result.failures} problem(s). Fix the spec + tokens.css + tokens.json together — they must agree.`,
    "",
  );
  process.stdout.write(out.join("\n"));
  process.exit(result.failures === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
