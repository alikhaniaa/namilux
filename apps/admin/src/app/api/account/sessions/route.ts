import { AppError, ERROR_FA, listStaffSessions, revokeStaffSession, staffRevokeAll } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "catalog.read",
  run: async ({ staff }) => ({ items: await listStaffSessions(db, staff.id, staff.sessionId) }),
});

export const DELETE = adminHandler({
  permission: "catalog.read",
  run: async ({ req, staff, ip }) => {
    const sp = new URL(req.url).searchParams;
    const actor = { type: "staff" as const, id: staff.id, ip };
    if (sp.get("all") === "1") {
      await staffRevokeAll(db, staff.id);
      return { revoked: "all" };
    }
    const id = sp.get("id") ?? "";
    if (id === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    const mine = (await listStaffSessions(db, staff.id)).some((s) => s.id === id);
    if (!mine) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    await revokeStaffSession(db, id, actor);
    return { revoked: id };
  },
});
