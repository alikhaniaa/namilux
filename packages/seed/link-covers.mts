// One-off (the spec companion): link each journal post to its WordPress featured image through the seed pipeline.
import { readFileSync } from "node:fs";
import { createDb, closeDb, eq, media, posts } from "@namilux/db";
import { ulid } from "@namilux/core";
import { emitRenditions } from "./src/images/renditions";
import { lqip } from "./src/images/lqip";
import { contentHash, contentKeyBase, fsStore } from "./src/images/manifest";
import { localFileForUrl } from "./src/extract/media-index";
const EXTRACT = "../../data/extract"; const SOURCE = (process.argv[2] ?? "legacy") as never;
const csv = readFileSync(`${EXTRACT}/05_media/media.csv`, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
const head = csv[0]!.split(","); const iId = head.indexOf("id"), iUrl = head.indexOf("source_url");
const lib = new Map<string, string>(); for (const l of csv.slice(1)) { const c = l.split(","); if (c[iUrl]?.startsWith("http")) lib.set(c[iId]!, c[iUrl]!); }
const wp = JSON.parse(readFileSync(`${EXTRACT}/03_content/posts.json`, "utf8")).posts as { slug: string; featured_media: string | number }[];
const db = createDb("migrate", { url: process.env.DATABASE_URL_MIGRATE!, poolMax: 2 });
const store = fsStore(process.env.MEDIA_DIR!, { dry: false });
const rows = await db.select({ id: posts.id, slug: posts.slug, cover: posts.coverMediaId }).from(posts);
const bySlug = new Map(wp.map((p) => [decodeURIComponent(p.slug), p]));
let linked = 0, missing = 0;
for (const r of rows) {
  if (r.cover) continue;
  const p = bySlug.get(decodeURIComponent(r.slug)); const url = p && lib.get(String(p.featured_media));
  const file = url ? localFileForUrl(EXTRACT, url) : null;
  if (!file) { missing++; continue; }
  const master = readFileSync(file); const hash = contentHash(master); const keyBase = contentKeyBase(hash);
  const existing = await db.select({ id: media.id }).from(media).where(eq(media.storageKey, `${keyBase}.jpg`)).limit(1);
  let mediaId = existing[0]?.id;
  if (!mediaId) {
    const emitted = await emitRenditions(master, "journal_cover", keyBase, store);
    mediaId = ulid();
    await db.insert(media).values({ id: mediaId, kind: "image", storageKey: emitted.renditions.master, mime: "image/jpeg", bytes: emitted.bytes[`${keyBase}.jpg`] ?? master.byteLength, width: emitted.width, height: emitted.height, lqip: await lqip(master).catch(() => null), renditionsJson: emitted.renditions, source: SOURCE });
  }
  await db.update(posts).set({ coverMediaId: mediaId }).where(eq(posts.id, r.id)); linked++;
}
console.log(JSON.stringify({ linked, missing, total: rows.length }));
await closeDb(db);
