import { z } from "zod";
import { appError, setRedirectActive } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: z.object({ isActive: z.boolean() }).strict(),
  permission: "seo.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    await setRedirectActive(db, id, input.isActive, { type: "staff", id: staff.id, ip });
    return { ok: true };
  },
});
