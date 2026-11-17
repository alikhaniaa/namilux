import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { jobs, security, tags } from "@namilux/core";
import { eq, media, sql } from "@namilux/db";
import { validateUpload } from "@namilux/integrations";
import { normalizeImage, normalizeJson } from "@namilux/seed/images/normalize";
import { emitRenditions } from "@namilux/seed/images/renditions";
import type { Slot } from "@namilux/seed/images/renditions";
import { lqip } from "@namilux/seed/images/lqip";
import { contentHash, contentKeyBase, fsStore, productKeyBase } from "@namilux/seed/images/manifest";
import { throwIfAborted } from "../runtime";
import type { Handler } from "../runtime";

type MediaKind = "product" | "content" | "brand" | "collection";

const SLOT_FOR: Record<MediaKind, Slot> = {
  product: "product",
  content: "journal_inline",
  brand: "band_desktop",
  collection: "category_tile",
};

export const mediaProcess: Handler = async ({ db, env, log, job, signal }) => {
  const p = job.payload as { uploadKey?: string; mediaId?: string; kind?: MediaKind; productId?: number };
  const kind: MediaKind = p.kind ?? "content";
  if (typeof p.uploadKey !== "string" || typeof p.mediaId !== "string") {
    log.warn({ jobId: job.id }, "media-process: missing uploadKey/mediaId");
    return;
  }
  const uploadKey: string = p.uploadKey;
  const mediaId: string = p.mediaId;

  const mediaDir = env.MEDIA_DIR;
  const store = fsStore(mediaDir, { dry: false });

  // Read the temp bytes from the media dir (the admin wrote them there under uploadKey).
  const tempPath = join(mediaDir, uploadKey);
  let source: Buffer;
  try {
    source = await readFile(tempPath);
  } catch {
    log.warn({ uploadKey }, "media-process: temp bytes missing");
    return;
  }

  async function reject(reason: string): Promise<void> {
    await db.update(media).set({ normalizeJson: { quarantined: true, reason }, updatedAt: new Date() }).where(eq(media.id, mediaId));
    await security.event(db, "upload.rejected", { reason, kind });
    await rm(tempPath, { force: true });
    log.warn({ mediaId, reason }, "media-process: upload rejected");
  }

  const check = validateUpload(new Uint8Array(source), "", "");
  if (!check.ok) {
    await reject(check.reason);
    return;
  }
  if (check.mime === "video/mp4") {
    await reject("video_p2"); // ffmpeg re-mux is P2
    return;
  }

  // Cancellation points bracket each expensive stage. Nothing has been written yet, so an abort
  // here leaves only the temp bytes, which the retry (or the next upload of the same file) reuses.
  throwIfAborted(signal);

  // Product images are normalized to the plate; other kinds go straight to the slot encoder.
  let master: Buffer;
  let normJson: Record<string, unknown> | null = null;
  if (kind === "product") {
    const result = await normalizeImage(source);
    if (result.status === "quarantine") {
      // Quarantined images are kept as gallery-only with the reason visible to the admin (A-015),
      // but they still get renditions from the trimmed source so the admin can preview them.
      normJson = normalizeJson(result.metrics, true, result.reasons);
      master = source;
    } else {
      normJson = normalizeJson(result.metrics, false, []);
      master = result.master;
    }
  } else {
    master = source;
  }

  throwIfAborted(signal);
  const hash = contentHash(master);
  const keyBase = kind === "product" && typeof p.productId === "number" ? productKeyBase(p.productId, 1, hash) : contentKeyBase(hash);
  // The signal reaches inside: renditions are encoded one at a time and stop between encodes. Keys
  // are content-hashed, so the objects already written are exactly what the retry would write.
  const emitted = await emitRenditions(master, SLOT_FOR[kind], keyBase, store, { signal });
  const lqipUri = await lqip(master).catch(() => null);
  throwIfAborted(signal);

  try {
    await db
      .update(media)
      .set({
        storageKey: emitted.renditions.master,
        mime: "image/jpeg",
        bytes: emitted.bytes[`${keyBase}.jpg`] ?? master.byteLength,
        width: emitted.width,
        height: emitted.height,
        lqip: lqipUri,
        renditionsJson: emitted.renditions,
        normalizeJson: normJson,
        updatedAt: new Date(),
      })
      .where(eq(media.id, mediaId));
  } catch (err: unknown) {
    // The final key is the content hash: the same bytes were processed before (media_storage_key_uq).
    // Fold this row into the existing one - product links move over, the duplicate row goes away.
    const pg = (err instanceof Error && err.cause instanceof Error ? err.cause : err) as { code?: string; constraint_name?: string };
    if (pg.code !== "23505") throw err;
    const twin = (await db.select({ id: media.id }).from(media).where(eq(media.storageKey, emitted.renditions.master)).limit(1))[0];
    if (twin === undefined) throw err;
    // The worker may not delete media rows or rewrite product links itself (roles.sql); the fold is
    // one SECURITY DEFINER function that moves every reference to the twin and then removes this row,
    // and refuses any row that is not still an unprocessed upload (migration 0009).
    await db.execute(sql`select nl_media_fold(${mediaId}, ${twin.id})`);
    await rm(tempPath, { force: true });
    log.info({ mediaId, twin: twin.id, kind }, "media duplicate folded");
    return;
  }

  await rm(tempPath, { force: true });

  if (typeof p.productId === "number") {
    await jobs.enqueue(db, "cache.revalidate", { tags: [tags.product(p.productId), tags.catalog] }, { uniqueKey: `revalidate:media:${mediaId}` });
  }
  log.info({ mediaId, kind, overBudget: emitted.overBudget.length }, "media processed");
};
