import "server-only";
import { notFound } from "next/navigation";
import { appError, can, channelScope, isSalesChannel, ordersRepo } from "@namilux/core";
import type { Order, Permission, SalesChannel, StaffUser } from "@namilux/core";
import { requireStaff } from "./session";
import { db } from "./db";

/**
 * Storefront scope on the server - the half of authz that `can` cannot express.
 *
 * A staff member whose role is confined to one site (core authz ROLE_CHANNEL: the `instalments`
 * role) must never read or change the other site's orders, returns, customers or sales, whatever
 * URL or API they call. Every such read passes its query through `siteFor`, and every record loaded
 * by id or code passes `inScope`; a record of the other site answers exactly like a missing one.
 */

/**
 * The storefront a list query must be confined to: the staff member's own when they are scoped
 * (whatever the request asked for), otherwise the one the request picked, if it named a real one.
 */
export function siteFor(staff: StaffUser, requested?: string | null): SalesChannel | undefined {
  const scope = channelScope(staff);
  if (scope !== null) return scope;
  return requested !== null && requested !== undefined && isSalesChannel(requested) ? requested : undefined;
}

/** True when this staff member may see a record of `channel`. */
export function inScope(staff: StaffUser, channel: SalesChannel): boolean {
  const scope = channelScope(staff);
  return scope === null || scope === channel;
}

/** An order by code for an API route: NOT_FOUND when it is missing or belongs to the other site. */
export async function scopedOrderByCode(staff: StaffUser, code: string): Promise<Order> {
  const order = await ordersRepo.findByCode(db, code);
  if (order === null || !inScope(staff, order.channel)) throw appError("NOT_FOUND", { details: { entity: "order" } });
  return order;
}

/**
 * The page guard for screens that are not per storefront (the inbox, analytics built from traffic
 * events, the catalogue's taxonomy and media, marketing, content, settings): the permission AND a
 * role that works across both sites. A confined staff member gets the same 404 screen as for a
 * permission they lack.
 */
export async function requireBothSites(p: Permission): Promise<StaffUser> {
  const staff = await requireStaff();
  if (!can(staff, p) || channelScope(staff) !== null) notFound();
  return staff;
}

/** Persian name of each storefront, as the admin labels them everywhere. */
export const SITE_LABEL: Record<SalesChannel, string> = {
  main: "نامی‌لوکس",
  instalments: "اقساطی",
};
