#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.resolve(HERE, "..");
export const DEFAULT_OUT = path.resolve(PKG_DIR, "../../apps/web/public");
export const DEFAULT_APP_DIR = path.resolve(PKG_DIR, "../../apps/web/src/app");
export const GLYPH_FILE = path.join(HERE, "glyph-noon.json");

const tokens = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "tokens.json"), "utf8"));

/** Only three colours exist in the icon set. */
export const COLORS = Object.freeze({
  ground: tokens.themes.light.frame,
  glyph: tokens.themes.light["frame-ink"],
  mark: tokens.themes.light["frame-accent"],
});

/** Design-canvas geometry (512 × 512). */
export const GEOMETRY = Object.freeze({
  canvas: 512,
  em: 300,
  markSide: 0.28,
  markGap: 0.18,
  opticalCentreY: 244,
  maskableBox: 0.6,
  splashWordmarkPct: 0.09,
  splashMonogramPct: 0.22,
});

/** Output file → [size, composition]. Order = manifest order then extras. */
export const SIZES = Object.freeze([
  { file: "icons/icon-192.png", size: 192, kind: "icon" },
  { file: "icons/icon-512.png", size: 512, kind: "icon" },
  { file: "icons/maskable-512.png", size: 512, kind: "maskable" },
  { file: "icons/mono-512.png", size: 512, kind: "mono" },
  { file: "icons/apple-touch-icon.png", size: 180, kind: "icon", opaque: true },
  { file: "icons/sc-shop.png", size: 96, kind: "icon" },
  { file: "app:icon.png", size: 48, kind: "icon" },
]);

/**
 * Current iPhone portrait sizes (CSS px × device pixel ratio). Verify against Apple's current
 * "Layout" table at implementation time; the media query needs the CSS size and DPR exactly.
 */
export const IOS_SPLASH = Object.freeze([
  { name: "iPhone 16 Pro Max / 17 Pro Max", w: 440, h: 956, r: 3 },
  { name: "iPhone Air", w: 420, h: 912, r: 3 },
  { name: "iPhone 16 Pro / 17 / 17 Pro", w: 402, h: 874, r: 3 },
  { name: "iPhone 16 Plus / 15 Plus / 15 Pro Max / 14 Pro Max", w: 430, h: 932, r: 3 },
  { name: "iPhone 16 / 16e / 15 / 15 Pro / 14 Pro", w: 393, h: 852, r: 3 },
  { name: "iPhone 14 Plus / 13 Pro Max / 12 Pro Max", w: 428, h: 926, r: 3 },
  { name: "iPhone 14 / 13 / 13 Pro / 12 / 12 Pro", w: 390, h: 844, r: 3 },
  { name: "iPhone 13 mini / 12 mini / 11 Pro / XS / X", w: 375, h: 812, r: 3 },
  { name: "iPhone 11 Pro Max / XS Max", w: 414, h: 896, r: 3 },
  { name: "iPhone 11 / XR", w: 414, h: 896, r: 2 },
  { name: "iPhone SE (2nd/3rd gen) / 8", w: 375, h: 667, r: 2 },
]);

/** @param {{ w: number; h: number; r: number }} e */
export function splashMedia(e) {
  return `screen and (device-width: ${e.w}px) and (device-height: ${e.h}px) and (-webkit-device-pixel-ratio: ${e.r}) and (orientation: portrait)`;
}

/** @param {{ w: number; h: number; r: number }} e */
export function splashFile(e) {
  return `splash/apple-splash-${e.w * e.r}x${e.h * e.r}.png`;
}

// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
// internals
// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 

/** «نامی‌لوکس» - the wordmark, ZWNJ spelled out so it survives any editor. */
const WORDMARK = "نامی\u200Cلوکس";
const SVG_NS = "http://www.w3.org/2000/svg";

const write = (s) => process.stdout.write(s + "\n");
const warn = (s) => process.stderr.write(s + "\n");

/** Deterministic short number formatting for SVG attributes. @param {number} v */
function n(v) {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? "0" : String(r);
}

/** DECISION: every interpolated value is XML-escaped, including the committed path data. */
function esc(s) {
  return String(s).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

const GLYPH_SNIPPET = `make-icons: missing ${path.relative(PKG_DIR, GLYPH_FILE).split(path.sep).join("/")}

The «ن» outline is a committed fontTools artefact. Generate it once (needs
\`pip install "fonttools[woff]>=4.50" brotli\`), from packages/tokens:

  python - <<'PY'
  import json
  from fontTools.ttLib import TTFont
  from fontTools.varLib.instancer import instantiateVariableFont
  from fontTools.pens.svgPathPen import SVGPathPen
  from fontTools.pens.boundsPen import BoundsPen
  f = instantiateVariableFont(TTFont("fonts/upstream/Estedad-VF.ttf"), {"wght": 800})
  gs = f.getGlyphSet(); name = f.getBestCmap()[0x0646]
  p = SVGPathPen(gs); gs[name].draw(p); b = BoundsPen(gs); gs[name].draw(b)
  print(json.dumps({"font":"Estedad","wght":800,"unitsPerEm":f["head"].unitsPerEm,
    "codepoint":"U+0646","advance":f["hmtx"][name][0],"bbox":list(b.bounds),"d":p.getCommands()}))
  PY

Write the JSON to scripts/glyph-noon.json and commit it, then re-run
\`pnpm --filter @namilux/tokens icons\`.`;

/**
 * The 512-canvas geometry of the monogram GROUP (glyph + square), per the ICON composition.
 * @param {{ unitsPerEm: number; bbox: number[]; d: string }} glyph
 */
function iconGroup(glyph) {
  const { canvas, em, markSide, markGap, opticalCentreY } = GEOMETRY;
  const scale = em / glyph.unitsPerEm;
  const [xMin, yMin, xMax, yMax] = glyph.bbox;
  const side = markSide * em; // 84
  const gap = markGap * em; // 54
  // square bottom sits on the baseline; the group's vertical extent is the union of glyph and square.
  const baseline = opticalCentreY + (Math.max(scale * yMax, side) + Math.min(scale * yMin, 0)) / 2;
  // centre the GROUP (not the glyph) horizontally: the square adds (gap + side) on the start side.
  const tx = canvas / 2 - (gap + side) / 2 - (scale * (xMin + xMax)) / 2;
  const markX = tx + scale * xMax + gap; // inline-START of the glyph = its right side (RTL)
  return {
    scale,
    baseline,
    tx,
    side,
    markX,
    left: tx + scale * xMin,
    right: markX + side,
    top: baseline - Math.max(scale * yMax, side),
    bottom: baseline - Math.min(scale * yMin, 0),
  };
}

/**
 * @param {ReturnType<typeof iconGroup>} g
 * @param {{ d: string }} glyph
 * @param {string} glyphColor @param {string} markColor
 */
function groupMarkup(g, glyph, glyphColor, markColor) {
  return (
    `<path d="${esc(glyph.d)}" fill="${esc(glyphColor)}" ` +
    `transform="translate(${n(g.tx)} ${n(g.baseline)}) scale(${n(g.scale)} ${n(-g.scale)})"/>` +
    `<rect x="${n(g.markX)}" y="${n(g.baseline - g.side)}" width="${n(g.side)}" height="${n(g.side)}" fill="${esc(markColor)}"/>`
  );
}

/** Scale a group's bbox into a `box`-wide square centred at (cx, cy). */
function fitTransform(g, box, cx, cy) {
  const k = box / Math.max(g.right - g.left, g.bottom - g.top);
  const gcx = (g.left + g.right) / 2;
  const gcy = (g.top + g.bottom) / 2;
  return `translate(${n(cx)} ${n(cy)}) scale(${n(k)}) translate(${n(-gcx)} ${n(-gcy)})`;
}

/** Splash frame constants - the probe and the final render share this coordinate frame. */
function splashFrame(entry) {
  const W = entry.w * entry.r;
  const H = entry.h * entry.r;
  const short = Math.min(W, H);
  const fontSize = GEOMETRY.splashWordmarkPct * short;
  return {
    W,
    H,
    short,
    fontSize,
    side: GEOMETRY.markSide * fontSize,
    gap: GEOMETRY.markGap * fontSize,
    anchorX: W / 2,
    baseline: 2 * fontSize,
    probeH: Math.ceil(3 * fontSize),
  };
}

function wordmarkText(f, family) {
  return (
    `<text x="${n(f.anchorX)}" y="${n(f.baseline)}" text-anchor="middle" direction="rtl" xml:lang="fa" ` +
    `font-family="${esc(family)}" font-weight="800" font-size="${n(f.fontSize)}" fill="${esc(COLORS.glyph)}">` +
    `${esc(WORDMARK)}</text>`
  );
}

/** The wordmark alone on a transparent canvas - used for the ink box and the fontconfig probe. */
function wordmarkProbeSvg(entry, family) {
  const f = splashFrame(entry);
  return (
    `<svg xmlns="${SVG_NS}" width="${n(f.W)}" height="${n(f.probeH)}" viewBox="0 0 ${n(f.W)} ${n(f.probeH)}">` +
    `${wordmarkText(f, family)}</svg>`
  );
}

// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
// compositions
// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 

/**
 * Builds the SVG for one composition on the 512 canvas.
 *
 * DECISION: the stub's JSDoc named two parameters, the contract names three
 * (`svgIcon(kind, size, glyph)`); the contract wins. `size` only sets the root width/height so
 * librsvg rasterises at the exact target size - the viewBox stays 512 × 512.
 * @param {"icon"|"maskable"|"mono"} kind
 * @param {number} size  rendered pixel size
 * @param {{ unitsPerEm: number; bbox: number[]; d: string }} glyph  glyph-noon.json
 * @returns {string} SVG markup (512 × 512 viewBox)
 */
export function svgIcon(kind, size, glyph) {
  const { canvas, maskableBox } = GEOMETRY;
  const g = iconGroup(glyph);
  const mono = kind === "mono";
  // MONO: glyph and square are both frame-ink on a transparent ground.
  const body = groupMarkup(g, glyph, COLORS.glyph, mono ? COLORS.glyph : COLORS.mark);
  const ground = mono ? "" : `<rect width="${canvas}" height="${canvas}" fill="${esc(COLORS.ground)}"/>`;
  const inner =
    kind === "maskable"
      ? `<g transform="${fitTransform(g, Math.round(canvas * maskableBox), canvas / 2, canvas / 2)}">${body}</g>`
      : body;
  return `<svg xmlns="${SVG_NS}" width="${n(size)}" height="${n(size)}" viewBox="0 0 ${canvas} ${canvas}">${ground}${inner}</svg>`;
}

/**
 * Builds the SVG for one splash screen (W×H device pixels).
 *
 * DECISION: `opts.textInk` (the measured ink box of the wordmark in the probe frame of
 * `splashFrame(entry)`) is required for the wordmark variant - the square is placed relative to the
 * shaped text, and shaping only exists after a raster pass. `main()` measures it; a missing
 * measurement throws rather than emitting a mis-centred wordmark.
 * @param {{ w: number; h: number; r: number }} entry
 * @param {{ wordmark: boolean; glyph: { unitsPerEm: number; bbox: number[]; d: string };
 *           textInk?: { x0: number; y0: number; x1: number; y1: number } }} opts
 */
export function svgSplash(entry, opts) {
  const f = splashFrame(entry);
  const ground = `<rect width="${n(f.W)}" height="${n(f.H)}" fill="${esc(COLORS.ground)}"/>`;
  const open = `<svg xmlns="${SVG_NS}" width="${n(f.W)}" height="${n(f.H)}" viewBox="0 0 ${n(f.W)} ${n(f.H)}">`;

  if (opts.wordmark === false) {
    const g = iconGroup(opts.glyph);
    const body = groupMarkup(g, opts.glyph, COLORS.glyph, COLORS.mark);
    const t = fitTransform(g, GEOMETRY.splashMonogramPct * f.short, f.W / 2, f.H / 2);
    return `${open}${ground}<g transform="${t}">${body}</g></svg>`;
  }

  const ink = opts.textInk;
  if (!ink) throw new Error("svgSplash: opts.textInk is required for the wordmark variant (measure it first)");

  // the square is «after the word» = its inline-END, which is the LEFT in RTL.
  const markX = ink.x0 - f.gap - f.side;
  const markY = f.baseline - f.side;
  const dx = f.W / 2 - (markX + ink.x1) / 2;
  const dy = f.H / 2 - (Math.min(ink.y0, markY) + Math.max(ink.y1, f.baseline)) / 2;
  const mark = `<rect x="${n(markX)}" y="${n(markY)}" width="${n(f.side)}" height="${n(f.side)}" fill="${esc(COLORS.mark)}"/>`;
  return `${open}${ground}<g transform="translate(${n(dx)} ${n(dy)})">${wordmarkText(f, "Estedad")}${mark}</g></svg>`;
}

// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
// fontconfig + raster helpers
// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 

/** Directories fontconfig must see: ours first, then the OS ones (so "Tahoma" can resolve). */
function fontDirs() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const candidates = [path.join(PKG_DIR, "fonts")];
  if (process.platform === "win32") {
    candidates.push(path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"));
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
  } else if (process.platform === "darwin") {
    candidates.push("/System/Library/Fonts", "/Library/Fonts", path.join(home, "Library/Fonts"));
  } else {
    candidates.push("/usr/share/fonts", "/usr/local/share/fonts", path.join(home, ".fonts"), path.join(home, ".local/share/fonts"));
  }
  return candidates.filter((d) => d && fs.existsSync(d));
}

function fontsConf(cacheDir) {
  const dirs = fontDirs()
    .map((d) => `  <dir>${esc(d)}</dir>`)
    .join("\n");
  return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
${dirs}
  <cachedir>${esc(cacheDir)}</cachedir>
  <match target="pattern">
    <test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Estedad</string></edit>
  </match>
</fontconfig>
`;
}

/** Bounding box of every non-transparent pixel, or null when nothing was drawn. */
async function inkBox(sharp, svg) {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < info.height; y += 1) {
    const row = y * info.width * ch;
    for (let x = 0; x < info.width; x += 1) {
      if (data[row + x * ch + ch - 1] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * The fontconfig probe of the rules: render the wordmark as "Estedad" and as "Tahoma"; identical
 * ink boxes mean both requests resolved to the same fallback face, i.e. Estedad is not visible.
 */
async function estedadVisible(sharp, entry) {
  const a = await inkBox(sharp, wordmarkProbeSvg(entry, "Estedad"));
  const b = await inkBox(sharp, wordmarkProbeSvg(entry, "Tahoma"));
  if (!a || !b) return false;
  return !(a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1);
}

// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 
// main
// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - 

/**
 * Loads glyph-noon.json (exit 2 with the fontTools snippet when missing), sets FONTCONFIG_FILE,
 * dynamically imports sharp, renders SIZES then IOS_SPLASH, writes splash/index.json.
 * @param {{ out?: string; appDir?: string; wordmark?: boolean; only?: "icons"|"splash" }} opts
 * @returns {Promise<number>} exit code
 */
export async function main(opts = {}) {
  const outDir = path.resolve(opts.out ?? DEFAULT_OUT);
  const appDir = path.resolve(opts.appDir ?? DEFAULT_APP_DIR);
  const wordmark = opts.wordmark !== false;
  const only = opts.only;

  // 1. the monogram outline - no partial output when it is absent.
  if (!fs.existsSync(GLYPH_FILE)) {
    warn(GLYPH_SNIPPET);
    return 2;
  }
  const glyph = JSON.parse(fs.readFileSync(GLYPH_FILE, "utf8"));
  if (
    typeof glyph.d !== "string" ||
    !Number.isFinite(glyph.unitsPerEm) ||
    !Array.isArray(glyph.bbox) ||
    glyph.bbox.length !== 4 ||
    !glyph.bbox.every((v) => Number.isFinite(v))
  ) {
    warn(`make-icons: glyph-noon.json is malformed (needs unitsPerEm, bbox[4], d)\n\n${GLYPH_SNIPPET}`);
    return 2;
  }

  // 2. fontconfig BEFORE libvips is loaded (rules) - a static sharp import would be too late.
  const buildDir = path.join(PKG_DIR, "fonts", ".build");
  fs.mkdirSync(buildDir, { recursive: true });
  const confFile = path.join(buildDir, "fonts.conf");
  fs.writeFileSync(confFile, fontsConf(path.join(buildDir, "fontconfig")));
  process.env.FONTCONFIG_FILE = confFile;
  const { default: sharp } = await import("sharp");

  const png = (img) => img.png({ compressionLevel: 9, palette: false });

  // 3. icons
  if (only !== "splash") {
    fs.mkdirSync(path.join(outDir, "icons"), { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    for (const entry of SIZES) {
      const target = entry.file.startsWith("app:")
        ? path.join(appDir, entry.file.slice("app:".length))
        : path.join(outDir, entry.file);
      let img = sharp(Buffer.from(svgIcon(entry.kind, entry.size, glyph)));
      if (entry.opaque === true) img = img.flatten({ background: COLORS.ground });
      const buf = await png(img).toBuffer();
      fs.writeFileSync(target, buf);
      write(`  ${entry.file.padEnd(28)} ${entry.size}×${entry.size}  ${buf.length} B`);
    }
  }

  // 4. splash
  if (only !== "icons") {
    fs.mkdirSync(path.join(outDir, "splash"), { recursive: true });
    if (wordmark && !(await estedadVisible(sharp, IOS_SPLASH[0]))) {
      warn(
        "make-icons: fontconfig cannot see Estedad (the wordmark would render in a fallback face).\n" +
          "  run with --no-wordmark or on the CI image.",
      );
      return 3;
    }
    const index = [];
    for (const entry of IOS_SPLASH) {
      /** @type {{ wordmark: boolean; glyph: typeof glyph; textInk?: { x0: number; y0: number; x1: number; y1: number } }} */
      const composition = { wordmark, glyph };
      if (wordmark) {
        const ink = await inkBox(sharp, wordmarkProbeSvg(entry, "Estedad"));
        if (!ink) {
          warn("make-icons: the wordmark rendered empty — run with --no-wordmark or on the CI image.");
          return 3;
        }
        composition.textInk = ink;
      }
      const rel = splashFile(entry);
      const buf = await png(sharp(Buffer.from(svgSplash(entry, composition)))).toBuffer();
      fs.writeFileSync(path.join(outDir, rel), buf);
      index.push({ href: `/${rel}`, media: splashMedia(entry), width: entry.w * entry.r, height: entry.h * entry.r });
      write(`  ${rel.padEnd(38)} ${buf.length} B`);
    }
    fs.writeFileSync(path.join(outDir, "splash", "index.json"), JSON.stringify(index, null, 2) + "\n");
    write(`  splash/index.json                      ${index.length} entries`);
  }

  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const val = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = val("--only");
  main({
    ...(val("--out") !== undefined ? { out: val("--out") } : {}),
    ...(val("--app-dir") !== undefined ? { appDir: val("--app-dir") } : {}),
    wordmark: !argv.includes("--no-wordmark"),
    ...(only === "icons" || only === "splash" ? { only } : {}),
  }).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`make-icons: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
