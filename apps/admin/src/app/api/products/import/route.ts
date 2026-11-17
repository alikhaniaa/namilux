import { z } from "zod";
import { importCsv, parseCsv } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { assertFreshSudo } from "@/lib/authz";
import { db } from "@/lib/db";

export const POST = adminHandler({
  schema: z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(true) }).strict(),
  permission: "catalog.bulk",
  sudo: false,
  bodyCap: 6 * 1024 * 1024,
  run: async ({ input, req, staff, ip }) => {
    if (!input.dryRun) assertFreshSudo(req, staff, "catalog.bulk");
    const { rows } = parseCsv(input.csv);
    const report = await importCsv(db, rows, { type: "staff", id: staff.id, ip }, input.dryRun);
    return input.dryRun ? report : { ...report, revalidate: report.tags };
  },
});
