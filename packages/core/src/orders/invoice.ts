import type { Db } from "@namilux/db";
import type { Settings } from "../settings/schema";

export type InvoiceView = {
  invoiceNo: string; issuedAt: string;
  seller: { legalName: string; address: string; phone: string; economicCode: string; registrationNo: string; vatId: string };
  buyer: { name: string; phone: string; address: string };
  lines: { name: string; sku: string | null; qty: number; unit: number; total: number; vat: number }[];
  subtotal: number; discount: number; shipping: number; vat: number; grandTotal: number;
  paid: { method: string; ref: string | null; at: string }; notes: string[];
};
import { appError } from "../errors";
import { enDigits, faDigits, formatJalali } from "../persian";
import { findById, nextInvoiceNo, updateStatus } from "./repo";

/** Jalali year via the persian formatter (keeps Intl inside persian/**). */
export function jalaliYear(d: Date): number {
  const numeric = enDigits(formatJalali(d.toISOString(), "numeric")); // e.g. "1405/06/06"
  const year = Number.parseInt(numeric, 10);
  return Number.isFinite(year) ? year : new Date(d).getUTCFullYear();
}

/** «۱۴۰۵-۰۰۰۱۲۳» - Persian digits, 6-digit zero-padded sequence. */
export function formatInvoiceNo(year: number, seq: number): string {
  return `${faDigits(year)}-${faDigits(String(seq).padStart(6, "0"))}`;
}

export async function assignInvoiceNo(db: Db, orderId: string, paidAt: Date): Promise<number> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (order.invoiceNo !== null) return order.invoiceNo; // idempotent
  const year = jalaliYear(paidAt);
  const seq = await nextInvoiceNo(db, year);
  await updateStatus(db, orderId, order.status, order.status, { invoiceNo: seq, invoiceYear: year });
  return seq;
}

export async function invoiceView(db: Db, orderId: string, ctx: { settings: Settings }): Promise<InvoiceView> {
  const order = await findById(db, orderId);
  const paidStates = new Set(["paid", "processing", "shipped", "delivered", "returned", "refunded"]);
  if (order === null || !paidStates.has(order.status)) throw appError("NOT_FOUND", { fa: "فاکتور در دسترس نیست" });

  const store = ctx.settings["store.info"] as Record<string, unknown>;
  const seals = ctx.settings["seals.enamad_code"] as unknown;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const vatPercent = Number((ctx.settings["commerce.vat_percent"] as { percent?: number } | number) ?? 0) || 0;
  const vatOf = (total: number): number => (vatPercent > 0 ? Math.round(total - total / (1 + vatPercent / 100)) : 0);

  const lines = order.items.map((it) => ({ name: it.name, sku: it.sku, qty: it.qty, unit: it.unitPrice, total: it.lineTotal, vat: vatOf(it.lineTotal) }));
  const year = jalaliYear(order.paidAt === null ? new Date() : new Date(order.paidAt));

  return {
    invoiceNo: order.invoiceNo === null ? "—" : formatInvoiceNo(year, order.invoiceNo),
    issuedAt: order.paidAt ?? order.placedAt,
    seller: {
      legalName: str(store.legalName ?? store.name),
      address: str(store.address),
      phone: str(store.phone),
      economicCode: str(store.economicCode),
      registrationNo: str(store.registrationNo),
      vatId: str(seals),
    },
    buyer: { name: order.address.recipientName, phone: order.phone, address: `${order.address.province} ${order.address.city} ${order.address.address}` },
    lines,
    subtotal: order.subtotal,
    discount: order.discountTotal,
    shipping: order.shippingTotal,
    vat: vatOf(order.grandTotal),
    grandTotal: order.grandTotal,
    paid: { method: "online", ref: order.invoiceNo === null ? null : String(order.invoiceNo), at: order.paidAt ?? order.placedAt },
    notes: [],
  };
}
