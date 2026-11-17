import { pageSchema, upsertPage } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const POST = adminHandler({
  schema: pageSchema,
  permission: "content.write",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertPage(db, input, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
