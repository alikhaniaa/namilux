/* eslint-disable no-console -- operator script: the report is its output */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { emitRenditions } from "../src/images/renditions.ts";
import { fsStore } from "../src/images/manifest.ts";

// postgres lives in packages/db, sharp in packages/seed (pnpm keeps each package's deps to itself)
const postgres = createRequire(resolve(import.meta.dirname, "../../db/package.json"))("postgres");
const sharp = createRequire(resolve(import.meta.dirname, "../package.json"))("sharp");

const dir = resolve(process.argv[2] ?? "");
const dry = process.argv.includes("--dry");
if (process.argv[2] === undefined) {
  console.error("usage: import-brand-logos.mjs <logo-dir> [--dry]");
  process.exit(2);
}
const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("DATABASE_URL_ADMIN is not set");
  process.exit(2);
}
const sql = postgres(url, { max: 1 });
const mediaRoot = resolve(process.env.MEDIA_DIR ?? resolve(import.meta.dirname, "../.media"));
const store = fsStore(mediaRoot, { dry });
const uid = () => "01" + randomBytes(12).toString("hex").toUpperCase();
const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** Insert (or reuse) the media row for an emitted rendition set. */
async function mediaRecord(result, mime, alt) {
  const key = result.renditions.master;
  const existing = (await sql`select id from media where storage_key = ${key}`)[0];
  if (existing) return existing.id;
  const id = uid();
  const bytes = Object.values(result.bytes).reduce((a, b) => a + b, 0);
  if (!dry) {
    await sql`insert into media (id, kind, storage_key, mime, bytes, width, height, alt, renditions_json, normalize_json, source)
      values (${id}, 'image', ${key}, ${mime}, ${bytes}, ${result.width}, ${result.height}, ${alt}, ${sql.json(result.renditions)}, ${null}, 'admin')`;
  }
  return id;
}

// ── 1 · brand marks ────────────────────────────────────────────────────────────────────────────
const brands = await sql`select id, slug, name_en, name_fa, logo_media_id from brands`;
const files = (await readdir(dir)).filter((f) => f.endsWith(".png"));
const report = { logos: [], covers: [], skipped: [] };
for (const brand of brands) {
  const file = files.find((f) => f === `${brand.slug}.png`);
  if (!file) {
    report.skipped.push({ brand: brand.slug, reason: "no <slug>.png in dir" });
    continue;
  }
  const png = await sharp(await readFile(resolve(dir, file))).png().toBuffer();
  const key = `brands/${brand.slug}-${hashOf(png)}-logo`;
  const result = await emitRenditions(png, "brand_logo", key, store);
  const id = await mediaRecord(result, "image/png", `${brand.name_fa} · ${brand.name_en}`);
  if (brand.logo_media_id !== id && !dry) await sql`update brands set logo_media_id = ${id} where id = ${brand.id}`;
  report.logos.push({ brand: brand.slug, id, key, width: result.width, height: result.height });
}

// ── 2 · derived collection covers ──────────────────────────────────────────────────────────────
const bare = await sql`
  select c.id, c.slug, c.name from collections c
  where c.kind in ('group', 'sub') and c.cover_media_id is null`;
for (const col of bare) {
  const pick = (await sql`
    select p.id, p.name, m.storage_key
    from collection_products cp
    join products p on p.id = cp.product_id
    join product_images pi on pi.product_id = p.id and pi.role = 'primary'
    join media m on m.id = pi.media_id
    where cp.collection_id = ${col.id} and p.status = 'active'
    order by p.price desc nulls last
    limit 1`)[0];
  if (!pick) {
    // No photographed product at all (three tableware/garment subs on 3 Sep 2026): borrow the parent
    // group's cover so the tile is never an empty plate; a real photo replaces it the moment one exists.
    const parent = (await sql`select p.cover_media_id from collections c join collections p on p.id = c.parent_id where c.id = ${col.id}`)[0];
    if (parent?.cover_media_id) {
      if (!dry) await sql`update collections set cover_media_id = ${parent.cover_media_id} where id = ${col.id}`;
      report.covers.push({ collection: col.slug, from: "parent cover", id: parent.cover_media_id });
    } else report.skipped.push({ collection: col.slug, reason: "no photographed active product, no parent cover" });
    continue;
  }
  const master = await readFile(resolve(mediaRoot, pick.storage_key));
  const key = `editorial/${hashOf(master)}-category-derived`;
  const result = await emitRenditions(master, "category_tile", key, store);
  const id = await mediaRecord(result, "image/jpeg", col.name);
  if (!dry) await sql`update collections set cover_media_id = ${id}, cover_dark_media_id = null where id = ${col.id}`;
  report.covers.push({ collection: col.slug, from: pick.name, id, key });
}

// ── 3 · caches ─────────────────────────────────────────────────────────────────────────────────
const signing = process.env.INTERNAL_SIGNING_KEY;
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
if (signing && !dry) {
  const body = JSON.stringify({ tags: ["nav", "catalog"] });
  const at = String(Date.now());
  const sig = createHmac("sha256", signing).update(`${at}.${body}`).digest("hex");
  try {
    const r = await fetch(`${origin}/api/internal/revalidate`, {
      method: "POST",
      // the spec: x-nl-sig = HMAC-SHA256(key, `${ts}.${body}`), x-nl-ts within five minutes
      headers: { "content-type": "application/json", "x-nl-ts": at, "x-nl-sig": sig },
      body,
    });
    report.revalidate = `${r.status}`;
  } catch (e) {
    report.revalidate = `failed: ${String(e).slice(0, 80)}`;
  }
}

console.log(JSON.stringify(report, null, 1));
await sql.end();
