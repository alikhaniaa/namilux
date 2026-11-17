import { z } from "zod";
import { appError, archivePost, postSchema, tags, upsertPost } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

function postId(p: Record<string, string>): number {
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
  return id;
}

export const PUT = adminHandler({
  schema: postSchema,
  permission: "content.write",
  run: async ({ input, params, staff, ip }) => {
    const { id, tags: t } = await upsertPost(db, { ...input, id: postId(params) }, { type: "staff", id: staff.id, ip });
    return { id, tags: t, revalidate: t };
  },
});
export const POST = adminHandler({
  schema: z.object({ archive: z.literal(true) }).strict(),
  permission: "content.write",
  run: async ({ params, staff, ip }) => {
    await archivePost(db, postId(params), { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.content, tags.sitemap] };
  },
});
