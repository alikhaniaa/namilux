import { z } from "zod";
import { listShippingMethodsAdmin, updateShippingMethod } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const rateSchema = z
  .object({
    flat: z.number().int().min(0).optional(),
    freeAbove: z.number().int().min(0).optional(),
    byProvince: z.record(z.string().min(1).max(8), z.number().int().min(0)).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(300).optional(),
    rate: rateSchema.optional(),
    provinces: z.array(z.string().min(1).max(8)).max(40).nullable().optional(),
    etaMinDays: z.number().int().min(0).max(60).optional(),
    etaMaxDays: z.number().int().min(0).max(60).optional(),
    isActive: z.boolean().optional(),
    sort: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export const GET = adminHandler({
  permission: "settings.read",
  run: async () => ({ items: await listShippingMethodsAdmin(db) }),
});

export const PUT = adminHandler({
  schema: z.object({ id: z.number().int().positive(), patch: patchSchema }).strict(),
  permission: "settings.write",
  run: async ({ input, staff, ip }) => {
    const patch = Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== undefined)) as Parameters<typeof updateShippingMethod>[2];
    const { method, tags } = await updateShippingMethod(db, input.id, patch, { type: "staff", id: staff.id, ip });
    return { method, revalidate: tags };
  },
});
