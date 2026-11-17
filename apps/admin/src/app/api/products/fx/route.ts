import { z } from "zod";
import { BASE_CURRENCIES, fxRecompute } from "@namilux/core";
import { assertFreshSudo } from "@/lib/authz";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const schema = z
  .object({
    baseCurrency: z.enum(BASE_CURRENCIES),
    rate: z.number().positive().max(1_000_000_000),
    rounding: z.union([z.literal(0), z.literal(10_000), z.literal(100_000)]).default(10_000),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "catalog.bulk",
  sudo: false,
  run: async ({ input, staff, ip, req }) => {
    if (!input.dryRun) assertFreshSudo(req, staff, "catalog.bulk");
    const result = await fxRecompute(db, { baseCurrency: input.baseCurrency, rate: input.rate, rounding: input.rounding }, { type: "staff", id: staff.id, ip }, input.dryRun);
    return { rows: result.rows, changed: result.changed, revalidate: result.tags };
  },
});
