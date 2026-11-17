import { collectionRuleSchema, previewRuleCount } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const POST = adminHandler({
  schema: collectionRuleSchema,
  permission: "catalog.read",
  run: ({ input }) => previewRuleCount(db, input),
});
