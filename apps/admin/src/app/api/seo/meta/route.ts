import { AppError, ERROR_FA, searchSeoEntities, seoMetaSchema, updateSeoMeta } from "@namilux/core";
import type { SeoEntityKind } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const KINDS = new Set<string>(["product", "category", "brand", "collection", "post", "page"]);

export const GET = adminHandler({
  permission: "seo.write",
  run: async ({ req }) => {
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind") ?? "product";
    if (!KINDS.has(kind)) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    return { items: await searchSeoEntities(db, kind as SeoEntityKind, sp.get("q") ?? "") };
  },
});

export const PUT = adminHandler({
  schema: seoMetaSchema,
  permission: "seo.write",
  run: async ({ input, staff, ip }) => {
    const { tags } = await updateSeoMeta(db, input, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: tags };
  },
});
