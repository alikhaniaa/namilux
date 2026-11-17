import {
  AppError,
  ERROR_FA,
  deleteStaff,
  listStaff,
  listStaffSessions,
  resetStaffPassword,
  revokeStaffSession,
  staffUpdateSchema,
  updateStaff,
} from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const idOf = (params: Record<string, string>): string => {
  const id = params.id ?? "";
  if (id === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
  return id;
};

export const GET = adminHandler({
  permission: "staff.manage",
  run: async ({ params }) => {
    const id = idOf(params);
    const row = (await listStaff(db)).find((s) => s.id === id);
    if (row === undefined) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    return { staff: row, sessions: await listStaffSessions(db, id) };
  },
});

/**
 * Edit, disable/enable, change role, reset TOTP and reset the password - one PUT, because the owner's
 * screen is one row of buttons. `password` comes back only when `resetPassword` was asked for, and
 * only that once.
 */
export const PUT = adminHandler({
  schema: staffUpdateSchema,
  permission: "staff.manage",
  run: async ({ input, params, staff, ip }) => {
    const id = idOf(params);
    const actor = { type: "staff" as const, id: staff.id, ip };
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.forceTotpReenrol === undefined ? {} : { forceTotpReenrol: input.forceTotpReenrol }),
    };
    const row = Object.keys(patch).length > 0 ? await updateStaff(db, id, patch, actor) : (await listStaff(db)).find((s) => s.id === id);
    if (row === undefined) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    if (input.resetPassword !== true) return { ...row };
    const { password } = await resetStaffPassword(db, id, actor);
    const after = (await listStaff(db)).find((s) => s.id === id);
    return { ...(after ?? row), password };
  },
});

/**
 * `?session=<id>` closes one session. `?hard=1` removes the account for good (the head admin's
 * «حذف»). Anything else disables it, which is the reversible default the table's other button uses.
 */
export const DELETE = adminHandler({
  permission: "staff.manage",
  run: async ({ params, req, staff, ip }) => {
    const id = idOf(params);
    const url = new URL(req.url);
    const session = url.searchParams.get("session");
    const actor = { type: "staff" as const, id: staff.id, ip };
    if (session !== null && session !== "") {
      await revokeStaffSession(db, session, actor);
      return { revoked: session };
    }
    if (url.searchParams.get("hard") === "1") {
      await deleteStaff(db, id, actor);
      return { deleted: id };
    }
    return { ...(await updateStaff(db, id, { isActive: false }, actor)) };
  },
});
