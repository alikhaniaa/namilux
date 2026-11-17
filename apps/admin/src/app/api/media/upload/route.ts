import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, ERROR_FA, assertCan, jobs, security, ulid } from "@namilux/core";
import { UPLOAD_MAX_BYTES, validateUpload } from "@namilux/integrations";
import { eq, media } from "@namilux/db";
import { db } from "@/lib/db";
import { ok, fail, clientIp, sameOrigin } from "@/lib/http-handler";
import { csrfCheck } from "@/lib/csrf";
import { currentStaff } from "@/lib/session";
import { env } from "@/env";

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    if (!csrfCheck(req)) return fail(new AppError("FORBIDDEN", 403, "درخواست نامعتبر است"));
    const staff = await currentStaff();
    if (staff === null) return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED));
    assertCan(staff, "media.write");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return fail(new AppError("VALIDATION", 400, "فایلی ارسال نشده است"));
    if (file.size > UPLOAD_MAX_BYTES) return fail(new AppError("VALIDATION", 413, "حجم فایل بیش از حد مجاز است"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fn = form.get("filename");
    const declaredName = typeof fn === "string" ? fn : "upload";
    const declaredMime = file.type === "" ? "application/octet-stream" : file.type;

    const verdict = validateUpload(bytes, declaredMime, declaredName);
    if (!verdict.ok) {
      await security.event(db, "upload.rejected", { reason: verdict.reason, staff: staff.id }, clientIp(req));
      return fail(new AppError("VALIDATION", 422, `فایل رد شد: ${verdict.reason}`, { reason: verdict.reason }));
    }

    // Content-hash key under a non-executable temp dir; the worker reads it, re-encodes, deletes it.
    const hash = createHash("sha256").update(bytes).digest("hex");
    const uploadKey = `tmp/${hash}.${verdict.ext}`;
    const tmpDir = join(env.MEDIA_DIR, "tmp");
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, `${hash}.${verdict.ext}`), bytes);

    const kind = verdict.mime.startsWith("video/") ? "video" : "image";
    const productIdRaw = Number(form.get("productId"));
    const productId = Number.isInteger(productIdRaw) && productIdRaw > 0 ? productIdRaw : undefined;

    // The key is the content hash: re-uploading identical bytes returns the existing row instead of
    // tripping the storage_key unique index (the worker de-duplicates renditions the same way).
    const existing = await db.select({ id: media.id, renditions: media.renditionsJson }).from(media).where(eq(media.storageKey, uploadKey)).limit(1);
    const dup = existing[0];
    if (dup !== undefined) return ok({ mediaId: dup.id, status: dup.renditions === null ? "processing" : "ready", duplicate: true }, { status: 202 });

    const mediaId = ulid();
    await db.insert(media).values({
      id: mediaId,
      kind,
      storageKey: uploadKey,
      mime: verdict.mime,
      bytes: bytes.length,
      source: "admin",
      uploadedByStaffId: staff.id,
    });

    await jobs.enqueue(
      db,
      "media.process",
      { uploadKey, mediaId, kind: productId === undefined ? "content" : "product", ...(productId === undefined ? {} : { productId }) },
      { uniqueKey: `media.process:${mediaId}` },
    );

    return ok({ mediaId, status: "processing" }, { status: 202 });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
