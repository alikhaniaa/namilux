import { faqSchema, listFaqsAdmin, upsertFaq } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({ permission: "content.write", run: () => listFaqsAdmin(db) });
export const POST = adminHandler({
  schema: faqSchema,
  permission: "content.write",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertFaq(db, input, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
