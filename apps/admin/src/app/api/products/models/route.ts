import { z } from "zod";
import { AppError, ERROR_FA, assertCan, createModel, groupModels, listModels, tags } from "@namilux/core";
import { assertFreshSudo } from "@/lib/authz";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "catalog.read",
  run: ({ req }) => {
    const sp = new URL(req.url).searchParams;
    const brandId = Number(sp.get("brandId"));
    const id = Number(sp.get("id"));
    if (sp.has("id") && (!Number.isSafeInteger(id) || id <= 0)) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    return listModels(db, { ...(sp.has("id") ? { id } : {}), ...(sp.get("q") === null ? {} : { q: sp.get("q") ?? "" }), ...(Number.isInteger(brandId) && brandId > 0 ? { brandId } : {}) }).then((groups) => ({ groups }));
  },
});

const schema = z.union([
  z.object({ name: z.string().trim().min(2).max(120), brandId: z.number().int().positive().nullable() }).strict(),
  z.object({ regroup: z.literal(true) }).strict(),
]);

export const POST = adminHandler({
  schema,
  permission: "catalog.write",
  run: async ({ input, staff, ip, req }) => {
    const actor = { type: "staff" as const, id: staff.id, ip };
    if ("regroup" in input) {
      assertCan(staff, "catalog.bulk");
      assertFreshSudo(req, staff, "catalog.bulk");
      const r = await groupModels(db, actor);
      return { ...r, revalidate: [tags.catalog] };
    }
    if (input.name === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    return createModel(db, { displayName: input.name, brandId: input.brandId }, actor);
  },
});
