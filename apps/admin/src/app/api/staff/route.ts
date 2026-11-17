import { createStaff, listStaff, staffCreateSchema } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";
import { staffValidationErrors } from "@/lib/staff-validation";

export const GET = adminHandler({
  permission: "staff.manage",
  run: async () => ({ items: await listStaff(db) }),
});

/**
 * The head admin adds a staff member. `password` is returned ONCE - the dialog shows it, the owner
 * reads it out, and it exists nowhere else (the row stores a scrypt hash and the audit entry stores
 * only who/which role). The account is active immediately with `must_change_password`, so the first
 * login is password → TOTP enrolment → panel, the flow that already exists.
 */
export const POST = adminHandler({
  schema: staffCreateSchema,
  validationErrors: staffValidationErrors,
  permission: "staff.manage",
  run: async ({ input, staff, ip }) => {
    const { staff: created, password } = await createStaff(
      db,
      {
        email: input.email,
        name: input.name,
        role: input.role,
        ...(input.password === undefined ? {} : { password: input.password }),
      },
      { type: "staff", id: staff.id, ip },
    );
    return { staff: created, password };
  },
});
