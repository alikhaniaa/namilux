import { z } from "zod";
import { insertRedirect, listRedirects } from "@namilux/core";
import type { RedirectRow } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "seo.write",
  run: ({ req }) => {
    const s = new URL(req.url).searchParams;
    const page = Number(s.get("page"));
    const q: { search?: string; source?: RedirectRow["source"]; page: number } = { page: Number.isInteger(page) && page > 0 ? page : 1 };
    const search = s.get("search");
    if (search !== null && search.trim() !== "") q.search = search;
    const source = s.get("source");
    if (source === "legacy" || source === "manual" || source === "auto_archive") q.source = source;
    return listRedirects(db, q);
  },
});

export const POST = adminHandler({
  schema: z
    .object({ fromPath: z.string().min(1).max(512), toPath: z.string().max(512), code: z.union([z.literal(301), z.literal(410)]) })
    .strict(),
  permission: "seo.write",
  run: async ({ input, staff, ip }) => {
    const { id } = await insertRedirect(db, { ...input, source: "manual" }, { type: "staff", id: staff.id, ip });
    return { id };
  },
});
