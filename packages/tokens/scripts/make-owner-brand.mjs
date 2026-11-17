#!/usr/bin/env node
/**
 * The owner's brand-asset build. One source file in, every raster the storefront, the panel and the
 * installed app reference out.
 *
 * SOURCE (7 Sep 2026). `design/brand/namilux-icon.png` - a square badge: a flat red field, a white
 * double-ring circle, a white «N», the word NAMILUX in white letter-spaced capitals beneath it. It
 * replaced the 31 Aug pair (`logo.png` on black + `logoName.png`) for every *icon* surface.
 *
 * WHAT DID NOT CHANGE. `logoName.png` still produces the header/footer lettering
 * (`/brand/brand-20260831/logo-name*`). The header is one graphite plane whose only chromatic notes
 * are teal and gilt; a saturated red badge at the inline start would out-shout every page and sits
 * next to `--danger` (#A3352B), which this UI reserves for destructive states. So the badge owns the
 * tab, the installed app, the splash and the social card; the lettering keeps the chrome. That also
 * leaves the phone's LCP element - the preloaded `logo-name-alpha.webp` - exactly where it was.
 *
 * WHY A NEW VERSION FOLDER. `next.config.ts` serves `/icons/*` and `/splash/*` `immutable`, so a
 * file overwritten under the old folder would never reach anyone who has already loaded it. The new
 * artwork therefore lands under `ICON_VERSION` and the old folder is left on disk untouched, so any
 * outside link to it still answers 200. The unversioned copies (`/icons/icon-512.png`, the JSON-LD
 * logo, `/splash/apple-splash-*.png`) are refreshed in place, as they always were.
 *
 * The badge is opaque and carries its own ground, so nothing here blends or recolours it: the icons
 * are straight resamples. Only three derivations exist, and each is mechanical - the maskable pads
 * the trimmed artwork out to the safe box on the badge's own red, the monochrome turns "how white
 * is this pixel" into alpha, and the splash/social cards centre the badge on graphite.
 *
 *   pnpm --filter @namilux/tokens icons     # this file, then the panel's derived set
 */
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sharp = createRequire(resolve(root, "packages/seed/package.json"))("sharp");
const tokens = JSON.parse(await readFile(resolve(root, "packages/tokens/tokens.json"), "utf8"));

/** The badge: everything an OS or a crawler shows as "the app". */
export const ICON_VERSION = "brand-20260907";
/** The lettering: the header, the footer, the panel's sidebar. Unchanged since 31 Aug. */
export const WORDMARK_VERSION = "brand-20260831";

const web = resolve(root, "apps/web/public");
const admin = resolve(root, "apps/admin/public");
const SOURCE = resolve(root, "design/brand/namilux-icon.png");
const frame = tokens.manifest.background_color;
const png = { compressionLevel: 9 };

async function output(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

// ── the source ────────────────────────────────────────────────────────────────────────────────
// Absent, this build does nothing at all: regenerating the icon set from the retired artwork would
// quietly undo the brand change, and a drawn stand-in would be worse than no change.
await access(SOURCE).catch(() => {
  throw new Error(
    `missing ${SOURCE}\n` +
      "The owner's square badge is the only source for the icon set. Save it there and re-run.",
  );
});

const badge = sharp(SOURCE).removeAlpha();
const source = await badge.metadata();
if (Math.abs(source.width - source.height) > 2) {
  throw new Error(`the badge must be square, got ${source.width}×${source.height}`);
}
if (source.width < 512) throw new Error(`the badge is ${source.width}px; 512 is the largest icon`);

/** The badge's own red, read off its corners - never a literal, and never a new design token. */
const flat = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const corner = (x, y) => {
  const p = (y * flat.info.width + x) * flat.info.channels;
  return { r: flat.data[p], g: flat.data[p + 1], b: flat.data[p + 2] };
};
const ground = corner(0, 0);
for (const [x, y] of [
  [flat.info.width - 1, 0],
  [0, flat.info.height - 1],
  [flat.info.width - 1, flat.info.height - 1],
]) {
  const c = corner(x, y);
  const drift = Math.max(Math.abs(c.r - ground.r), Math.abs(c.g - ground.g), Math.abs(c.b - ground.b));
  if (drift > 6) throw new Error(`the badge's field is not flat (corner drift ${drift})`);
}

/**
 * The badge is white-on-red; the mark it replaces is gold-on-black and still sits two files away in
 * the same folder. Copied to this path by mistake it would satisfy every check above - square, flat
 * corners - and then be silently baked into the whole icon set on a ground the derivations read as
 * "the field". So the two are told apart here, by the only thing that distinguishes them without
 * looking: this field is a saturated red, and the artwork on it is white.
 */
const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
if (!(ground.r > 110 && ground.r > ground.g * 1.7 && ground.r > ground.b * 1.7)) {
  throw new Error(
    `the field is rgb(${ground.r} ${ground.g} ${ground.b}), which is not the badge's red — ` +
      "this looks like the retired gold-on-black mark (design/brand/logo.png), not namilux-icon.png",
  );
}

const square = await sharp(SOURCE).removeAlpha().png().toBuffer();
/** The ring, the N and the word with the flat field cropped away - the maskable and mono start here. */
const artwork = await sharp(square).trim({ threshold: 10 }).png().toBuffer();

const trimmed = await sharp(artwork).metadata();
if (trimmed.width >= source.width - 2 || trimmed.height >= source.height - 2) {
  throw new Error("the artwork runs to the badge's edge; the maskable safe zone needs a margin of field");
}
// The ring, the N and the word are white: the top percentile of the trimmed artwork has to be, too.
const art = await sharp(artwork).removeAlpha().raw().toBuffer({ resolveWithObject: true });
let brightest = { r: 0, g: 0, b: 0 };
for (let i = 0; i < art.info.width * art.info.height; i += 1) {
  const at = i * art.info.channels;
  const pixel = { r: art.data[at], g: art.data[at + 1], b: art.data[at + 2] };
  if (luma(pixel) > luma(brightest)) brightest = pixel;
}
if (luma(brightest) < 200 || Math.max(brightest.r, brightest.g, brightest.b) - Math.min(brightest.r, brightest.g, brightest.b) > 40) {
  throw new Error(
    `the brightest artwork is rgb(${brightest.r} ${brightest.g} ${brightest.b}), not the badge's white — ` +
      "check that design/brand/namilux-icon.png is the red badge and not the retired metallic mark",
  );
}

// ── icons ─────────────────────────────────────────────────────────────────────────────────────
// The badge is already a finished square icon, so these are plain resamples. `favicon-16` keeps the
// whole composition rather than cropping to the ring: at that size the word is a texture either
// way, and a second, differently-composed mark is a worse answer than a soft one.
const icons = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["sc-shop.png", 96],
  ["favicon-32.png", 32],
  ["favicon-16.png", 16],
];

const scale = (size) =>
  sharp(square).resize({ width: size, height: size, fit: "fill", kernel: "lanczos3" }).png(png).toBuffer();

for (const [file, size] of icons) {
  const bytes = await scale(size);
  await output(resolve(web, "icons", ICON_VERSION, file), bytes);
  await output(resolve(web, "icons", file), bytes); // JSON-LD and the legacy first-party references.
}

// The maskable's artwork must survive a circular crop, so it sits inside the 60 % safe box while the
// badge's own red floods the whole 512. Padding the *trimmed* artwork, not the badge, keeps the area
// outside that box a single exact colour - which is what the check at the bottom of this file reads.
const safe = Math.round(512 * 0.6);
const inner = await sharp(artwork).resize({ width: safe, height: safe, fit: "inside" }).toBuffer();
const maskable = await sharp({ create: { width: 512, height: 512, channels: 3, background: ground } })
  .composite([{ input: inner, gravity: "centre" }])
  .png(png)
  .toBuffer();
await output(resolve(web, "icons", ICON_VERSION, "maskable-512.png"), maskable);
await output(resolve(web, "icons/maskable-512.png"), maskable);

// The monochrome variant is the silhouette Android tints: white where the badge is white, clear
// where it is red. `min(r,g,b)` separates the two cleanly - the field's red has a low blue and
// green, the lettering has neither.
const lift = await sharp(artwork).resize({ width: 430, height: 430, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
const floor = Math.min(ground.r, ground.g, ground.b);
const pixels = lift.info.width * lift.info.height;
const rgba = Buffer.alloc(pixels * 4);
for (let i = 0; i < pixels; i += 1) {
  const at = i * lift.info.channels;
  const whiteness = Math.min(lift.data[at], lift.data[at + 1], lift.data[at + 2]);
  rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
  rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(((whiteness - floor) * 255) / (255 - floor))));
}
const silhouette = await sharp(rgba, { raw: { width: lift.info.width, height: lift.info.height, channels: 4 } }).png().toBuffer();
const mono = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: silhouette, gravity: "centre" }])
  .png(png)
  .toBuffer();
await output(resolve(web, "icons", ICON_VERSION, "mono-512.png"), mono);
await output(resolve(web, "icons/mono-512.png"), mono);

// ── the lettering (unchanged source, unchanged paths) ─────────────────────────────────────────
const name = await sharp(resolve(root, "design/brand/logoName.png")).trim({ threshold: 12 }).png().toBuffer();
const wordmark = await sharp(name).resize({ width: 800, withoutEnlargement: true }).png(png).toBuffer();
for (const out of [web, admin]) await output(resolve(out, "brand", WORDMARK_VERSION, "logo-name.png"), wordmark);

// ── the app-router file conventions ───────────────────────────────────────────────────────────
await output(resolve(root, "apps/web/src/app/icon.png"), await scale(512));

/**
 * The favicon: three PNG frames in an ICO container - the one file here whose CONTAINER Next has
 * to parse, and the reason both apps answered 500 on every route.
 *
 * `src/app/favicon.ico` is an App-Router metadata convention: the framework decodes it while it
 * builds the layout's `<head>`, with the Rust `image` crate - whose ICO reader accepts a PNG frame
 * **only in 8-bit RGBA**. The badge is opaque, so `sharp` wrote its resamples as RGB (colour type
 * 2) and Turbopack answered «Format error decoding Ico: The PNG is not in RGBA format!» - not on
 * the icon's own URL, which is static, but on *every route in both apps*, as a 500 out of the
 * shared layout. `next build` fails the same way.
 *
 * So the frames are forced to RGBA: `ensureAlpha()` adds the opaque channel the badge does not
 * need, and `palette: false` stops sharp from quantising three flat colours into an indexed image
 * (colour type 3), which that reader rejects just as flatly. Every frame's IHDR is read back before
 * the file is written - this is exactly the kind of silence a library upgrade restores.
 */
const ICO_SIZES = [16, 32, 48];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const frames = await Promise.all(
  ICO_SIZES.map((size) =>
    sharp(square)
      .resize({ width: size, height: size, fit: "fill", kernel: "lanczos3" })
      .ensureAlpha()
      .png({ ...png, palette: false })
      .toBuffer(),
  ),
);
frames.forEach((bytes, i) => {
  // IHDR is the first chunk of a PNG and its layout is fixed: width, height, bit depth, colour
  // type at byte 25. 8 and 6 are "8-bit RGBA"; anything else is the 500 above.
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) throw new Error(`favicon frame ${ICO_SIZES[i]} is not a PNG`);
  if (bytes[24] !== 8 || bytes[25] !== 6) {
    throw new Error(
      `favicon frame ${ICO_SIZES[i]} is bit depth ${bytes[24]}, colour type ${bytes[25]}; ` +
        "Next's ICO reader takes 8-bit RGBA (8/6) only",
    );
  }
});
const head = Buffer.alloc(6 + 16 * frames.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(frames.length, 4);
let offset = head.length;
frames.forEach((bytes, i) => {
  const pos = 6 + i * 16;
  head[pos] = head[pos + 1] = ICO_SIZES[i];
  head.writeUInt16LE(1, pos + 4);
  head.writeUInt16LE(32, pos + 6);
  head.writeUInt32LE(bytes.length, pos + 8);
  head.writeUInt32LE(offset, pos + 12);
  offset += bytes.length;
});
const ico = Buffer.concat([head, ...frames]);
for (const app of ["web", "admin"]) await output(resolve(root, `apps/${app}/src/app/favicon.ico`), ico);

// ── splash ────────────────────────────────────────────────────────────────────────────────────
// iOS paints these full-bleed behind the launching app, so the ground is the manifest's graphite - 
// the colour the shell settles on - and the badge is the only thing on it. The retired composition
// stacked the mark over the lettering; the badge already carries the word, so a second copy of it
// underneath would just be the name twice.
const splashes = JSON.parse(await readFile(resolve(web, "splash/index.json"), "utf8"));
for (const entry of splashes) {
  const short = Math.min(entry.width, entry.height);
  const side = Math.round(short * 0.42);
  const art = await sharp(square).resize({ width: side, height: side, fit: "fill", kernel: "lanczos3" }).toBuffer();
  const bytes = await sharp({ create: { width: entry.width, height: entry.height, channels: 3, background: frame } })
    .composite([{ input: art, gravity: "centre" }])
    .png(png)
    .toBuffer();
  const filename = entry.href.split("/").at(-1);
  await output(resolve(web, "splash", ICON_VERSION, filename), bytes);
  await output(resolve(web, "splash", filename), bytes);
}

// ── the social card ───────────────────────────────────────────────────────────────────────────
// The site-wide og:image fallback (`app/layout.tsx`). Every catalogue page overrides it with its own
// card out of the media store - this is what the routes that have no entity behind them show, and
// what a share of the origin itself shows before `og/site.jpg` has ever been rendered.
const OG = { width: 1200, height: 630 };
const badgeOnCard = await sharp(square)
  .resize({ width: Math.round(OG.height * 0.56), height: Math.round(OG.height * 0.56), fit: "fill", kernel: "lanczos3" })
  .toBuffer();
const card = await sharp({ create: { ...OG, channels: 3, background: frame } })
  .composite([{ input: badgeOnCard, gravity: "centre" }])
  .png(png)
  .toBuffer();
await output(resolve(web, "brand", ICON_VERSION, `og-${OG.width}x${OG.height}.png`), card);

// ── validation ────────────────────────────────────────────────────────────────────────────────
for (const [file, size] of [...icons, ["maskable-512.png", 512], ["mono-512.png", 512]]) {
  const meta = await sharp(resolve(web, "icons", ICON_VERSION, file)).metadata();
  if (meta.width !== size || meta.height !== size) throw new Error(`Wrong icon dimensions: ${file}`);
}
const mask = await sharp(maskable).raw().toBuffer({ resolveWithObject: true });
const edge = mask.data.subarray(0, 3);
for (let y = 0; y < 512; y += 1) {
  for (let x = 0; x < 512; x += 1) {
    if (x >= 102 && x < 410 && y >= 102 && y < 410) continue;
    const p = (y * 512 + x) * mask.info.channels;
    if (!mask.data.subarray(p, p + 3).equals(edge)) throw new Error("Maskable artwork exceeds safe box");
  }
}
const monoStats = await sharp(mono).stats();
if (monoStats.channels[3].min !== 0 || monoStats.channels[3].max !== 255) throw new Error("Monochrome alpha missing");
const cardMeta = await sharp(card).metadata();
if (cardMeta.width !== OG.width || cardMeta.height !== OG.height) throw new Error("Wrong social-card dimensions");

// Only now, with every file written and checked, does the version the apps read move. Both halves
// of the change therefore land in one command: a manifest can never name a folder that was not
// built, which on these immutable paths would be a permanently cached 404 on the app's own icon.
// The file is edited line by line rather than re-serialised - tokens.json is hand-formatted and a
// round-trip through JSON.stringify would reflow all 150 lines of it.
const tokensPath = resolve(root, "packages/tokens/tokens.json");
const before = await readFile(tokensPath, "utf8");
let brand = false;
const after = before
  .split("\n")
  .map((line) => {
    if (line.trimStart().startsWith('"brand"')) brand = true;
    else if (brand && line.trimStart().startsWith("}")) brand = false;
    if (!brand) return line;
    const key = line.match(/^(\s*)"(icons|wordmark)":\s*"[^"]*"(,?)$/);
    if (key === null) return line;
    return `${key[1]}"${key[2]}": "${key[2] === "icons" ? ICON_VERSION : WORDMARK_VERSION}"${key[3]}`;
  })
  .join("\n");
if (JSON.parse(after).brand.icons !== ICON_VERSION) throw new Error("could not update tokens.json brand.icons");
if (after !== before) await writeFile(tokensPath, after);

console.log(
  JSON.stringify({
    version: ICON_VERSION,
    wordmarkVersion: WORDMARK_VERSION,
    ground: `rgb(${ground.r} ${ground.g} ${ground.b})`,
    icons: icons.length + 2,
    favicon: `ico ${ICO_SIZES.join("/")} · 8-bit RGBA png frames`,
    splashes: splashes.length,
    card: `${OG.width}x${OG.height}`,
    wordmarkBytes: wordmark.length,
    validated: true,
  }),
);
