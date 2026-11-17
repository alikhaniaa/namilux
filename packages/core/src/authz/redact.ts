import { appError } from "../errors";
import type { StaffUser } from "../types";
import { can } from "./permissions";

/**
 * Field-level enforcement for the two money fields on a product: the purchase price and the margin
 * derived from it. A hidden form field is never the protection - every server read strips the value
 * and every server write refuses it, so a non-owner cannot learn a cost price by reading the JSON a
 * page hydrates from, by calling the API directly, or by posting one back.
 */
const COST_FA = "قیمت خرید و حاشیهٔ سود فقط برای مدیر ارشد است";

type WithCost = { costPrice: number | null };

/**
 * Replaces the cost price with `null` for staff without `catalog.cost`. `null` is the same value the
 * column carries when no cost was ever recorded, so nothing downstream needs a second shape - and
 * `margin()` below therefore returns null too.
 */
export function redactCost<T extends WithCost>(row: T, canCost: boolean): T {
  return canCost ? row : { ...row, costPrice: null };
}

/** The admin product view with its cost stripped when the reader may not see money. */
export function redactProductAdminView<V extends { row: WithCost }>(view: V, canCost: boolean): V {
  return canCost ? view : { ...view, row: redactCost(view.row, false) };
}

/**
 * Margin in Toman and as a fraction of the selling price. Returns null when there is no cost to
 * compare against - which, for a non-owner, is always, because the cost arrived redacted.
 */
export function margin(row: { price: number } & WithCost): { toman: number; ratio: number } | null {
  if (row.costPrice === null || row.price <= 0) return null;
  const toman = row.price - row.costPrice;
  return { toman, ratio: toman / row.price };
}

/**
 * Write side. The key is absent from an admin's form payload (the field is never rendered and
 * `viewToInput` omits it), so its PRESENCE from a staff member without `catalog.cost` is a hand-made
 * request and is refused rather than quietly dropped - dropping it would let the caller believe the
 * cost was saved.
 */
export function assertMayWriteCost(staff: Pick<StaffUser, "role" | "isActive">, body: object): void {
  if (!Object.prototype.hasOwnProperty.call(body, "costPrice")) return;
  if (!can(staff, "catalog.cost")) throw appError("FORBIDDEN", { fa: COST_FA });
}

/** Drops `costPrice` from an object without mutating it (the form payload an admin may send). */
export function withoutCost<T extends object>(input: T): Omit<T, "costPrice"> {
  const { costPrice: _cost, ...rest } = input as T & { costPrice?: unknown };
  return rest;
}
