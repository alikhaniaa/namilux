import type { z } from "zod";
import { fa } from "@/i18n/fa";

/** Only fixed display messages leave the server, never submitted values. */
export function staffValidationErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || Object.hasOwn(fields, field)) continue;
    if (field === "password") fields.password = issue.code === "too_small" ? fa["staff.password.short"] : fa["staff.password.invalid"];
    else if (field === "email") fields.email = fa["staff.identity.invalid"];
    else if (field === "name") fields.name = fa["staff.name.invalid"];
    else if (field === "role") fields.role = fa["staff.role.invalid"];
  }
  return fields;
}
