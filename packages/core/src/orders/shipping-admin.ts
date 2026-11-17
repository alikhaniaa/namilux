import { type Db, asc, eq, shippingMethods } from "@namilux/db";
import { audit } from "../audit";
import { tags } from "../cache/tags";
import { appError } from "../errors";
import type { ShippingMethod } from "../pricing/shipping";
import type { Actor } from "../types";

export type ShippingMethodPatch = Partial<Pick<ShippingMethod, "name" | "description" | "rate" | "provinces" | "etaMinDays" | "etaMaxDays" | "isActive" | "sort">>;

function mapRow(r: typeof shippingMethods.$inferSelect): ShippingMethod {
  return {
    id: r.id,
    key: r.key as ShippingMethod["key"],
    name: r.name,
    description: r.description ?? "",
    kind: r.kind,
    rate: r.rateJson ?? {},
    provinces: (r.provinces ?? null) as ShippingMethod["provinces"],
    etaMinDays: r.etaMinDays,
    etaMaxDays: r.etaMaxDays,
    isActive: r.isActive,
    sort: r.sort,
  };
}

export async function listShippingMethodsAdmin(db: Db): Promise<ShippingMethod[]> {
  const rows = await db.select().from(shippingMethods).orderBy(asc(shippingMethods.sort), asc(shippingMethods.id));
  return rows.map(mapRow);
}

export async function updateShippingMethod(db: Db, id: number, patch: ShippingMethodPatch, actor: Actor): Promise<{ method: ShippingMethod; tags: string[] }> {
  const rows = await db.select().from(shippingMethods).where(eq(shippingMethods.id, id)).limit(1);
  const current = rows[0];
  if (current === undefined) throw appError("NOT_FOUND", { details: { entity: "shipping_method", id } });
  const before = mapRow(current);
  const next: ShippingMethod = { ...before, ...patch };
  if (next.etaMinDays > next.etaMaxDays) throw appError("VALIDATION", { details: { field: "etaMaxDays" } });
  const rateValues = [next.rate.flat, next.rate.freeAbove, ...Object.values(next.rate.byProvince ?? {})];
  if (rateValues.some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))) throw appError("VALIDATION", { details: { field: "rate" } });
  await db
    .update(shippingMethods)
    .set({
      name: next.name,
      description: next.description,
      rateJson: next.rate,
      provinces: next.provinces,
      etaMinDays: next.etaMinDays,
      etaMaxDays: next.etaMaxDays,
      isActive: next.isActive,
      sort: next.sort,
    })
    .where(eq(shippingMethods.id, id));
  await audit.log(db, actor, "shipping.method.update", "shipping_methods", String(id), before, next);
  return { method: next, tags: [tags.settings] };
}
