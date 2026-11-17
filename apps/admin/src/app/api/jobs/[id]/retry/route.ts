import { appError, jobs } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const POST = adminHandler({
  permission: "system.jobs",
  run: async ({ params, staff, ip }) => {
    const id = params.id ?? "";
    if (id === "") throw appError("VALIDATION", { details: { field: "id" } });
    await jobs.retry(db, id, { type: "staff", id: staff.id, ip });
    return { ok: true };
  },
});
