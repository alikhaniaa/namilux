import { z } from "zod";
import { assertCan, createManualOrder, getSettings, submitManualOrder, updateDraft } from "@namilux/core";
import type { ManualOrderInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { assertFreshSudo } from "@/lib/authz";
import { db } from "@/lib/db";
import { env } from "@/env";

const addressSchema = z
  .object({
    label: z.string().max(40).default("خانه"),
    recipientName: z.string().min(1).max(80),
    recipientPhone: z.string().min(1).max(20),
    province: z.string().min(1).max(40),
    city: z.string().min(1).max(60),
    address: z.string().min(1).max(500),
    plaque: z.string().max(20).nullable().default(null),
    unit: z.string().max(20).nullable().default(null),
    postcode: z.string().max(20),
  })
  .strict();

const createSchema = z
  .object({
    customerId: z.string().nullable(),
    phone: z.string().min(1).max(20),
    items: z
      .array(z.object({ productId: z.number().int().positive(), qty: z.number().int().positive(), unitPriceOverride: z.number().int().min(0).optional(), overrideReason: z.string().max(200).optional() }).strict())
      .min(1),
    discount: z.object({ amount: z.number().int().min(0), note: z.string().max(200) }).strict().optional(),
    shippingMethodKey: z.string().min(1).max(40),
    address: addressSchema,
    adminNote: z.string().max(2000).optional(),
    source: z.enum(["phone", "instagram", "whatsapp", "admin"]),
    channelRef: z.string().max(120).optional(),
  })
  .strict();

const submitSchema = z
  .object({
    orderId: z.string().min(1),
    submit: z.enum(["payment_link", "mark_paid"]),
    method: z.enum(["card_to_card", "cash", "pos"]).optional(),
    reference: z.string().max(120).optional(),
  })
  .strict();

export const POST = adminHandler({
  schema: z.union([submitSchema, createSchema]),
  permission: "orders.create",
  sudo: false,
  bodyCap: 32 * 1024,
  run: async ({ input, req, staff, ip }) => {
    const actor = { type: "staff" as const, id: staff.id, ip };
    const settings = await getSettings(db);
    if ("submit" in input) {
      if (input.submit === "mark_paid") {
        assertFreshSudo(req, staff, "orders.manual_payment");
        assertCan(staff, "orders.manual_payment");
      }
      const manual =
        input.submit === "mark_paid" && input.method !== undefined && input.reference !== undefined
          ? { method: input.method, reference: input.reference }
          : undefined;
      return submitManualOrder(db, input.orderId, input.submit, actor, { settings, env: { SITE_ORIGIN: env.SITE_ORIGIN }, ...(manual === undefined ? {} : { manual }) });
    }
    if (input.items.some((i) => i.unitPriceOverride !== undefined)) assertCan(staff, "catalog.price");
    const manualInput = { ...input, settle: { kind: "payment_link" as const } } as unknown as ManualOrderInput;
    return createManualOrder(db, manualInput, actor, { settings });
  },
});

export const PUT = adminHandler({
  schema: z.object({ orderId: z.string().min(1), patch: createSchema.partial() }).strict(),
  permission: "orders.create",
  run: async ({ input, staff, ip }) => {
    const settings = await getSettings(db);
    return updateDraft(db, input.orderId, input.patch as Partial<ManualOrderInput>, { type: "staff", id: staff.id, ip }, { settings });
  },
});
