import { listPostsAdmin, postSchema, upsertPost } from "@namilux/core";
import type { PostStatus } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "content.write",
  run: ({ req }) => {
    const s = new URL(req.url).searchParams;
    const status = s.get("status");
    const search = s.get("search");
    const page = Number(s.get("page"));
    const q: { status?: PostStatus; search?: string; page: number } = { page: Number.isInteger(page) && page > 0 ? page : 1 };
    if (status !== null) q.status = status as PostStatus;
    if (search !== null && search.trim() !== "") q.search = search;
    return listPostsAdmin(db, q);
  },
});
export const POST = adminHandler({
  schema: postSchema,
  permission: "content.write",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertPost(db, input, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
