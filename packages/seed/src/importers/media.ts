import { readFile } from "node:fs/promises";
import { ulid } from "@namilux/core/ids";
import {
  brands as brandsTable,
  count,
  eq,
  inArray,
  media as mediaTable,
  pages as pagesTable,
  posts as postsTable,
  productImages as productImagesTable,
  products as productsTable,
} from "@namilux/db";
import type { SeedContext } from "../context.js";
import { localFileForUrl } from "../extract/media-index.js";
import { readLegacyProducts, type LegacyImageRef, type LegacyProduct } from "../extract/products.js";
import { lqip } from "../images/lqip.js";
import {
  contentHash,
  contentKeyBase,
  fsStore,
  manifestStats,
  mediaRow,
  ogKeyFor,
  productKeyBase,
  writeManifest,
  type ImageManifestEntry,
  type ObjectStore,
} from "../images/manifest.js";
import { CANVAS, SUBJECT_H, normalizeImage, normalizeJson } from "../images/normalize.js";
import { ogCard } from "../images/og-card.js";
import { chooseRoles } from "../images/quarantine.js";
import { emitRenditions, masterKeyFor, type RenditionsJson } from "../images/renditions.js";
import { collectImageUrls, sanitizeLegacyHtml } from "../transform/sanitize.js";
import { SeedAbort, inChunks } from "../idempotency.js";
import { warn } from "../report.js";

export type MediaStageOptions = { limit?: number; only?: number[]; concurrency?: number; skipExisting?: boolean };

export const DEFAULT_CONCURRENCY = 4;

/**
 * DECISION: one master per product - the primary candidate (lowest existing gallery position), which
 * is exactly what v1's normalize-images.mjs processed ("the widest existing render of each product's
 * primary image") and what v2 §5.1 measured (295 products → 269 normalized / 26 quarantined). The M0
 * gate encodes those numbers (295 media, 269/26 ± 5); normalising all 1,259 gallery files would put
 * `media.normalized` near 1,150 and fail it. The remaining gallery images stay in the extract for the
 * admin media job (A-015) and are counted in the report.
 */
export const PRIMARY_IMAGE_ONLY = true;

const CHUNK = 200;

type Task = {
  productId: number;
  slug: string;
  displayName: string;
  ref: LegacyImageRef;
};

type Processed = {
  task: Task;
  entry: ImageManifestEntry;
  media: {
    id: string;
    storageKey: string;
    bytes: number;
    width: number;
    height: number;
    alt: string;
    lqip: string | null;
    renditions: RenditionsJson;
    normalizeJson: object | null;
  } | null;
  quarantined: boolean;
};

async function pool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const width = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        await fn(item);
      }
    }),
  );
}

function primaryRef(p: LegacyProduct): LegacyImageRef | null {
  const usable = p.images.filter((i) => i.exists && i.file);
  return usable.length > 0 ? (usable[0] as LegacyImageRef) : null;
}

async function processTask(
  ctx: SeedContext,
  task: Task,
  store: ObjectStore,
  known: Map<string, string>,
  skipExisting: boolean,
): Promise<Processed> {
  const base: ImageManifestEntry = { productId: task.productId, n: task.ref.n, sourceFile: task.ref.file, status: "ok" };
  let bytes: Buffer;
  try {
    bytes = await readFile(task.ref.file);
  } catch {
    return { task, entry: { ...base, status: "missing" }, media: null, quarantined: false };
  }

  const hash = contentHash(bytes);
  const keyBase = productKeyBase(task.productId, task.ref.n, hash);
  const masterKey = masterKeyFor(keyBase);
  const alt = task.ref.alt.trim() || task.displayName;

  const existingId = known.get(masterKey);
  if (existingId !== undefined && skipExisting) {
    // Rerun / interrupted run: the bytes behind a content-hashed key cannot have changed.
    const row = await ctx.db
      .select({ normalizeJson: mediaTable.normalizeJson })
      .from(mediaTable)
      .where(eq(mediaTable.storageKey, masterKey))
      .limit(1);
    const quarantined = row[0]?.normalizeJson?.quarantined === true;
    return {
      task,
      entry: { ...base, status: quarantined ? "quarantine" : "ok", keyBase, mediaId: existingId },
      media: null,
      quarantined,
    };
  }

  try {
    const result = await normalizeImage(bytes);
    const quarantined = result.status === "quarantine";
    // A quarantined source still ships, unnormalised, as a gallery image (v2 §5.1: quarantine is
    // metadata, not deletion) - the renditions come from the ORIGINAL bytes, object-contain.
    const master = result.status === "ok" ? result.master : bytes;
    const emitted = await emitRenditions(master, "product", keyBase, store);
    let placeholder: string | null = null;
    try {
      placeholder = await lqip(master);
    } catch {
      warn(ctx.report, `lqip skipped for product ${task.productId} image ${task.ref.n} (over 400 B)`);
    }
    for (const key of emitted.overBudget) ctx.report.media.overBudget.push(key);

    return {
      task,
      quarantined,
      entry: {
        ...base,
        status: quarantined ? "quarantine" : "ok",
        metrics: result.metrics,
        ...(result.status === "quarantine" ? { reasons: result.reasons } : {}),
        keyBase,
      },
      media: {
        id: existingId ?? ulid(),
        storageKey: masterKey,
        bytes: emitted.bytes[masterKey] ?? master.length,
        width: emitted.width,
        height: emitted.height,
        alt,
        lqip: placeholder,
        renditions: emitted.renditions,
        normalizeJson: normalizeJson(
          result.metrics,
          quarantined,
          result.status === "quarantine" ? result.reasons : [],
        ),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.report.media.failures.push({ productId: task.productId, n: task.ref.n, file: task.ref.file, error: message });
    return { task, entry: { ...base, status: "failed", error: message }, media: null, quarantined: false };
  }
}

/** Brand + site OG cards; product cards are generated on demand by the `og.generate` job. */
async function writeOgCards(ctx: SeedContext, store: ObjectStore): Promise<number> {
  const brands = await ctx.db.select({ slug: brandsTable.slug, nameFa: brandsTable.nameFa }).from(brandsTable);
  let written = 0;
  const put = async (key: string, label: string): Promise<void> => {
    if (await store.has(key)) {
      written += 1;
      return;
    }
    const card = await ogCard({ kind: "brand", label });
    await store.put(key, card, "image/jpeg");
    written += 1;
  };
  for (const b of brands) await put(ogKeyFor("b", b.slug), b.nameFa);
  const siteKey = ogKeyFor("site", "site");
  if (!(await store.has(siteKey))) {
    const { SITE_OG_LABEL } = await import("../images/og-card.js");
    await store.put(siteKey, await ogCard({ kind: "site", label: SITE_OG_LABEL }), "image/jpeg");
  }
  written += 1;
  return written;
}

/**
 * Second pass of the two-pass content-image rule (importers/content.ts rules): any `<img src>` in a
 * legacy body that resolves to a local file becomes `/media/c/<hash>…` and the body is re-sanitized.
 * With an empty (gitignored) `05_media/files/` this resolves nothing and only counts.
 */
async function processContentImages(ctx: SeedContext, store: ObjectStore): Promise<void> {
  const posts = await ctx.db.select({ id: postsTable.id, body: postsTable.bodyHtml }).from(postsTable);
  const pages = await ctx.db.select({ id: pagesTable.id, body: pagesTable.bodyHtml }).from(pagesTable);
  const urls = new Set<string>();
  for (const row of [...posts, ...pages]) for (const u of collectImageUrls(row.body)) urls.add(u);
  if (urls.size === 0) return;

  const resolved = new Map<string, string>();
  for (const url of urls) {
    const file = localFileForUrl(ctx.extractDir, url);
    if (file === null) continue;
    try {
      const bytes = await readFile(file);
      const keyBase = contentKeyBase(contentHash(bytes));
      const emitted = await emitRenditions(bytes, "journal_inline", keyBase, store);
      resolved.set(url, `/media/${emitted.renditions.master}`);
      ctx.report.media.renditions += Object.keys(emitted.bytes).length;
    } catch (err) {
      warn(ctx.report, `content image failed: ${url} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  ctx.report.media.contentImagesResolved = resolved.size;
  ctx.report.media.contentImagesDropped = Math.max(0, urls.size - resolved.size);
  if (resolved.size === 0 || ctx.dry) return;

  const resolveImage = (src: string): string | null => resolved.get(src) ?? null;
  for (const row of posts) {
    const html = sanitizeLegacyHtml(row.body, { resolveImage, siteOrigin: ctx.siteOrigin }).html;
    if (html !== row.body) await ctx.db.update(postsTable).set({ bodyHtml: html }).where(eq(postsTable.id, row.id));
  }
  for (const row of pages) {
    const html = sanitizeLegacyHtml(row.body, { resolveImage, siteOrigin: ctx.siteOrigin }).html;
    if (html !== row.body) await ctx.db.update(pagesTable).set({ bodyHtml: html }).where(eq(pagesTable.id, row.id));
  }
}

export async function run(ctx: SeedContext, opts?: MediaStageOptions): Promise<void> {
  const productCount = await ctx.db.select({ n: count() }).from(productsTable);
  if ((productCount[0]?.n ?? 0) === 0) {
    // DECISION: SeedAbort's code union has no "wrong stage order" member, and MISSING_TABLE is the
    // one that means "the database is not in the state the seed needs". The CLI maps every SeedAbort
    // to exit 2, which is what the media EDGE CASE requires.
    throw new SeedAbort("the media stage needs product rows: run the catalog stage first", "MISSING_TABLE");
  }

  const skipExisting = opts?.skipExisting ?? true;
  const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;
  const store = fsStore(ctx.mediaDir, { dry: ctx.dry });

  const { products } = await readLegacyProducts(ctx.extractDir, {
    limit: opts?.limit ?? ctx.limit,
    ...(opts?.only ? { only: opts.only } : {}),
  });
  const dbProducts = new Map(
    (
      await ctx.db
        .select({ id: productsTable.id, slug: productsTable.slug, displayName: productsTable.displayName })
        .from(productsTable)
    ).map((p) => [p.id, p]),
  );

  const tasks: Task[] = [];
  for (const p of products) {
    const db = dbProducts.get(p.id);
    if (db === undefined) continue;
    const withFile = p.images.filter((i) => i.file);
    ctx.report.media.missingSource += withFile.filter((i) => !i.exists).length;
    const ref = primaryRef(p);
    if (ref === null) continue;
    tasks.push({ productId: p.id, slug: db.slug, displayName: db.displayName, ref });
  }

  const known = new Map<string, string>();
  for (const row of await ctx.db.select({ id: mediaTable.id, storageKey: mediaTable.storageKey }).from(mediaTable)) {
    known.set(row.storageKey, row.id);
  }

  const processed: Processed[] = [];
  await pool(tasks, concurrency, async (task) => {
    const result = await processTask(ctx, task, store, known, skipExisting);
    processed.push(result);
    if (processed.length % 50 === 0) ctx.log.info({ done: processed.length, of: tasks.length }, "media progress");
  });
  processed.sort((a, b) => a.task.productId - b.task.productId || a.task.ref.n - b.task.ref.n);

  const fresh = processed.filter((p) => p.media !== null);
  if (!ctx.dry && fresh.length > 0) {
    await inChunks(fresh, CHUNK, async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx
          .insert(mediaTable)
          .values(
            chunk.map((p) =>
              mediaRow({
                id: (p.media as NonNullable<Processed["media"]>).id,
                masterKey: (p.media as NonNullable<Processed["media"]>).storageKey,
                masterBytes: (p.media as NonNullable<Processed["media"]>).bytes,
                width: (p.media as NonNullable<Processed["media"]>).width,
                height: (p.media as NonNullable<Processed["media"]>).height,
                alt: (p.media as NonNullable<Processed["media"]>).alt,
                lqip: (p.media as NonNullable<Processed["media"]>).lqip,
                renditions: (p.media as NonNullable<Processed["media"]>).renditions,
                normalizeJson: (p.media as NonNullable<Processed["media"]>).normalizeJson,
              }),
            ),
          )
          // Content-hashed key: an existing row already describes these exact bytes.
          .onConflictDoNothing({ target: mediaTable.storageKey });
      });
    });
  }

  // Media ids as they now exist in the database (an ON CONFLICT DO NOTHING may have kept an older id).
  const idByKey = new Map(known);
  if (!ctx.dry && fresh.length > 0) {
    const keys = fresh.map((p) => (p.media as NonNullable<Processed["media"]>).storageKey);
    await inChunks(keys, 500, async (chunk) => {
      for (const row of await ctx.db
        .select({ id: mediaTable.id, storageKey: mediaTable.storageKey })
        .from(mediaTable)
        .where(inArray(mediaTable.storageKey, chunk))) {
        idByKey.set(row.storageKey, row.id);
      }
    });
  }

  // product_images: delete-then-insert per product, and only when the desired set actually differs.
  const byProduct = new Map<number, Processed[]>();
  for (const p of processed) byProduct.set(p.task.productId, [...(byProduct.get(p.task.productId) ?? []), p]);

  const desiredByProduct = new Map<number, { mediaId: string; role: "primary" | "gallery"; sort: number; alt: string }[]>();
  for (const [productId, list] of byProduct) {
    const roles = chooseRoles(
      list.map((p) => ({
        n: p.task.ref.n,
        exists: p.entry.status !== "missing",
        quarantined: p.quarantined,
        failed: p.entry.status === "failed",
      })),
    );
    const rows: { mediaId: string; role: "primary" | "gallery"; sort: number; alt: string }[] = [];
    for (const role of roles) {
      const item = list.find((p) => p.task.ref.n === role.n);
      if (item === undefined) continue;
      const key = item.media?.storageKey ?? (item.entry.keyBase ? masterKeyFor(item.entry.keyBase) : null);
      const mediaId = key ? idByKey.get(key) : undefined;
      if (mediaId === undefined) continue;
      item.entry.mediaId = mediaId;
      item.entry.role = role.role;
      rows.push({ mediaId, role: role.role, sort: role.sort, alt: item.media?.alt ?? item.task.displayName });
    }
    desiredByProduct.set(productId, rows);
  }

  if (!ctx.dry) {
    const productIds = [...desiredByProduct.keys()];
    const current = new Map<number, string>();
    await inChunks(productIds, 500, async (chunk) => {
      const rows = await ctx.db
        .select({
          productId: productImagesTable.productId,
          mediaId: productImagesTable.mediaId,
          role: productImagesTable.role,
          sort: productImagesTable.sort,
          alt: productImagesTable.alt,
        })
        .from(productImagesTable)
        .where(inArray(productImagesTable.productId, chunk));
      const grouped = new Map<number, { mediaId: string; role: string; sort: number; alt: string }[]>();
      for (const r of rows) {
        grouped.set(r.productId, [
          ...(grouped.get(r.productId) ?? []),
          { mediaId: r.mediaId, role: r.role, sort: r.sort, alt: r.alt },
        ]);
      }
      for (const [productId, list] of grouped) {
        list.sort((a, b) => a.sort - b.sort);
        current.set(productId, JSON.stringify(list));
      }
    });

    for (const [productId, rows] of desiredByProduct) {
      if (JSON.stringify(rows) === (current.get(productId) ?? "[]")) continue;
      await ctx.db.transaction(async (tx) => {
        await tx.delete(productImagesTable).where(eq(productImagesTable.productId, productId));
        if (rows.length === 0) return;
        await tx.insert(productImagesTable).values(rows.map((r) => ({ productId, ...r })));
      });
    }

    // The journal cover is the first content image of the post; without local files it stays NULL.
    await processContentImages(ctx, store);
  } else {
    await processContentImages(ctx, store);
  }

  ctx.report.media.ogCards = await writeOgCards(ctx, store);

  const entries = processed.map((p) => p.entry);
  const stats = manifestStats(entries);
  ctx.report.media.masters = entries.filter((e) => e.status === "ok" || e.status === "quarantine").length;
  ctx.report.media.normalized = stats.normalized;
  ctx.report.media.widthBound = stats.widthBound;
  ctx.report.media.atTarget = stats.atTarget;
  ctx.report.media.quarantined = stats.quarantined;
  for (const p of processed) {
    if (p.media === null) continue;
    ctx.report.media.renditions +=
      Object.keys(p.media.renditions.avif).length + Object.keys(p.media.renditions.webp).length + 1;
  }

  await writeManifest(
    ctx.mediaDir,
    {
      generatedAt: ctx.now().toISOString(),
      canvas: { w: CANVAS.W, h: CANVAS.H },
      targetSubjectH: SUBJECT_H,
      entries,
      stats,
    },
    { dry: ctx.dry },
  );

  ctx.log.info(
    {
      masters: ctx.report.media.masters,
      normalized: stats.normalized,
      quarantined: stats.quarantined,
      widthBound: stats.widthBound,
      atTarget: stats.atTarget,
      withoutPrimary: stats.productsWithoutPrimary,
      failures: ctx.report.media.failures.length,
    },
    "media stage done",
  );
}
