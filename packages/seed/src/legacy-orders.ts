import { readFile } from "node:fs/promises";
import { seedEnv } from "@namilux/config/env";
import { orderCode, shortCode, ulid } from "@namilux/core/ids";
import { normalizePhone } from "@namilux/core/persian";
import {
  customers as customersTable,
  eq,
  like,
  orderItems as orderItemsTable,
  orders as ordersTable,
  payments as paymentsTable,
  products as productsTable,
  type OrderStatus,
} from "@namilux/db";
import { parse } from "csv-parse/sync";
import { pino } from "pino";
import { createContext, type SeedContext } from "./context.js";
import { openSeedDb } from "./db.js";
import { resolveExtractDir, resolveMediaDir } from "./extract/paths.js";

/**
 * DECISION: `on-hold` maps to `expired`, not `pending_payment`. The contract's own parenthetical says
 * "(expired)", and a `pending_payment` row would join the reservation/expiry job's queue and text a
 * customer about a months-old cart. `expired` is the terminal, side-effect-free reading.
 */
export const LEGACY_STATUS_MAP: Record<string, OrderStatus> = {
  completed: "delivered",
  processing: "processing",
  "on-hold": "expired",
  cancelled: "cancelled",
  canceled: "cancelled",
  refunded: "refunded",
  failed: "failed",
  pending: "expired",
};

/** Statuses that mean money actually arrived - the only ones that get a manual payment row. */
export const PAID_STATUSES: readonly OrderStatus[] = ["processing", "shipped", "delivered", "refunded", "paid"];

/** `customer_note` prefix that makes the import idempotent without a schema change. */
export const LEGACY_NOTE_PREFIX = "legacy:";

type Row = Record<string, string | undefined>;

function pick(row: Row, names: readonly string[]): string {
  for (const n of names) {
    const v = row[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function toInt(s: string): number {
  const digits = s.replace(/[^0-9]/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}

export type LegacyLine = { sku: string; name: string; qty: number; unitPrice: number };

/** `name|qty|price` items separated by ";" - the shape a Woo CSV export packs into one cell. */
export function parseItemsCell(raw: string): LegacyLine[] {
  const out: LegacyLine[] = [];
  for (const chunk of raw.split(";")) {
    const parts = chunk.split("|").map((p) => p.trim());
    if (parts.length < 2 || !parts[0]) continue;
    out.push({
      sku: parts[3] ?? "",
      name: parts[0],
      qty: Math.max(1, toInt(parts[1] ?? "1")),
      unitPrice: toInt(parts[2] ?? "0"),
    });
  }
  return out;
}

type LegacyOrder = {
  legacyId: string;
  placedAt: Date | null;
  status: OrderStatus;
  phone: string | null;
  firstName: string;
  lastName: string;
  province: string;
  city: string;
  address: string;
  postcode: string;
  subtotal: number;
  discount: number;
  shipping: number;
  paymentRef: string;
  lines: LegacyLine[];
};

export function groupRows(rows: Row[]): LegacyOrder[] {
  const byId = new Map<string, LegacyOrder>();
  for (const row of rows) {
    const legacyId = pick(row, ["order_id", "id", "order_number", "number"]);
    if (!legacyId) continue;
    const existing = byId.get(legacyId);
    const line = (() => {
      const name = pick(row, ["item_name", "line_item_name", "product_name"]);
      if (!name) return null;
      return {
        sku: pick(row, ["item_sku", "sku"]),
        name,
        qty: Math.max(1, toInt(pick(row, ["item_qty", "qty", "quantity"]) || "1")),
        unitPrice: toInt(pick(row, ["item_price", "unit_price", "price"])),
      } satisfies LegacyLine;
    })();

    if (existing) {
      if (line) existing.lines.push(line);
      continue;
    }
    const rawStatus = pick(row, ["status", "order_status"]).toLowerCase().replace(/^wc-/, "");
    const placed = pick(row, ["date", "order_date", "date_created", "paid_date"]);
    const parsedDate = placed ? new Date(placed) : null;
    byId.set(legacyId, {
      legacyId,
      placedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      status: LEGACY_STATUS_MAP[rawStatus] ?? "expired",
      phone: normalizePhone(pick(row, ["phone", "billing_phone", "customer_phone"])),
      firstName: pick(row, ["first_name", "billing_first_name"]),
      lastName: pick(row, ["last_name", "billing_last_name"]),
      province: pick(row, ["province", "billing_state", "state"]),
      city: pick(row, ["city", "billing_city"]),
      address: pick(row, ["address", "billing_address_1", "address_1"]),
      postcode: pick(row, ["postcode", "billing_postcode", "zip"]),
      subtotal: toInt(pick(row, ["subtotal", "order_subtotal", "cart_total"])),
      discount: toInt(pick(row, ["discount", "discount_total", "cart_discount"])),
      shipping: toInt(pick(row, ["shipping", "shipping_total", "order_shipping"])),
      paymentRef: pick(row, ["payment_ref", "transaction_id", "ref_id"]),
      lines: line ? [line] : parseItemsCell(pick(row, ["items", "line_items"])),
    });
  }
  return [...byId.values()];
}

export async function importLegacyOrders(
  ctx: SeedContext,
  csvPath: string,
  dry: boolean,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const rows: Row[] = parse(await readFile(csvPath), { columns: true, bom: true, relax_column_count: true });
  const orders = groupRows(rows);
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Idempotency: the legacy id lives in `customer_note` as `legacy:<id>` (rules: no schema change).
  const seen = new Set<string>();
  for (const row of await ctx.db
    .select({ note: ordersTable.customerNote })
    .from(ordersTable)
    .where(like(ordersTable.customerNote, `${LEGACY_NOTE_PREFIX}%`))) {
    const id = (row.note ?? "").slice(LEGACY_NOTE_PREFIX.length).split(/\s/)[0];
    if (id) seen.add(id);
  }

  const bySku = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const p of await ctx.db
    .select({ id: productsTable.id, sku: productsTable.sku, name: productsTable.name })
    .from(productsTable)) {
    if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p.id);
    byName.set(p.name.trim().toLowerCase(), p.id);
  }

  for (const order of orders) {
    if (seen.has(order.legacyId)) {
      skipped += 1;
      continue;
    }
    if (!order.phone) {
      errors.push(`order ${order.legacyId}: no usable phone number — skipped`);
      skipped += 1;
      continue;
    }

    const lines = order.lines.filter((l) => l.unitPrice > 0);
    const unknown = order.lines.filter((l) => l.unitPrice > 0 && !bySku.has(l.sku.trim().toLowerCase()) && !byName.has(l.name.trim().toLowerCase()));
    const subtotal = order.subtotal || lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
    const grandTotal = Math.max(0, subtotal - order.discount + order.shipping);
    // DECISION: the spec declares `order_items.product_id NOT NULL`, so an item whose product is not in
    // the catalogue cannot be a row. Its name/qty is appended to `customer_note` instead of being
    // dropped, and the line is skipped.
    const noteParts = [`${LEGACY_NOTE_PREFIX}${order.legacyId}`];
    for (const l of unknown) noteParts.push(`legacy-line: ${l.name} ×${l.qty}`);

    if (dry) {
      imported += 1;
      continue;
    }

    try {
      await ctx.db.transaction(async (tx) => {
        const phone = order.phone as string;
        const found = await tx
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.phone, phone))
          .limit(1);
        let customerId = found[0]?.id;
        if (customerId === undefined) {
          customerId = ulid();
          await tx.insert(customersTable).values({
            id: customerId,
            phone,
            // They verify on first login (rules).
            phoneVerifiedAt: null,
            firstName: order.firstName || null,
            lastName: order.lastName || null,
            referralCode: shortCode(8),
          });
        }

        const orderId = ulid();
        await tx.insert(ordersTable).values({
          id: orderId,
          code: orderCode(),
          customerId,
          phone,
          status: order.status,
          source: "web",
          subtotal,
          discountTotal: order.discount,
          shippingTotal: order.shipping,
          pointsDiscount: 0,
          grandTotal,
          customerNote: noteParts.join(" · "),
          addressSnapshotJson: {
            recipientName: `${order.firstName} ${order.lastName}`.trim(),
            recipientPhone: phone,
            province: order.province,
            city: order.city,
            address: order.address,
            postcode: order.postcode,
          } as never,
          placedAt: order.placedAt,
        });

        const items = lines
          .map((l) => {
            const productId = bySku.get(l.sku.trim().toLowerCase()) ?? byName.get(l.name.trim().toLowerCase());
            if (productId === undefined) return null;
            return {
              id: ulid(),
              orderId,
              productId,
              name: l.name,
              sku: l.sku || null,
              unitPrice: l.unitPrice,
              qty: l.qty,
              lineTotal: l.unitPrice * l.qty,
            };
          })
          .filter((i): i is NonNullable<typeof i> => i !== null);
        if (items.length > 0) await tx.insert(orderItemsTable).values(items);

        // Never a gateway record: the money moved in the old system, so this is the manual receipt.
        if (PAID_STATUSES.includes(order.status) && grandTotal > 0) {
          await tx.insert(paymentsTable).values({
            id: ulid(),
            orderId,
            driver: "manual",
            amount: grandTotal,
            status: "succeeded",
            refId: order.paymentRef || null,
            verifiedAt: order.placedAt,
          });
        }
      });
      imported += 1;
    } catch (err) {
      errors.push(`order ${order.legacyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Counts only - never a phone number, a name or an address.
  ctx.report.legacyOrders = { rows: orders.length, imported, skipped };
  ctx.log.info({ rows: orders.length, imported, skipped, errors: errors.length }, "legacy orders imported");
  return { imported, skipped, errors };
}

/** `node packages/seed/src/legacy-orders.ts <orders.csv> [--dry]` (contract) - never part of `db:seed`. */
async function main(argv: string[]): Promise<number> {
  const csvPath = argv.find((a) => !a.startsWith("-"));
  const dry = argv.includes("--dry");
  if (!csvPath) {
    process.stderr.write("usage: legacy-orders <orders.csv> [--dry]\n");
    return 1;
  }
  const env = seedEnv();
  const log = pino({ level: env.LOG_LEVEL, base: { app: "seed" } });
  const seedDb = await openSeedDb({
    url: env.DATABASE_URL_ADMIN,
    allowRemote: process.env["SEED_ALLOW_REMOTE"] === "1",
  });
  try {
    const ctx = createContext({
      db: seedDb.db,
      extractDir: resolveExtractDir(null),
      mediaDir: resolveMediaDir(env.MEDIA_DIR),
      siteOrigin: env.SITE_ORIGIN,
      dry,
      limit: null,
      force: false,
      // The order import is not a seed stage: it never runs an importer.
      only: [],
      log,
    });
    const result = await importLegacyOrders(ctx, csvPath, dry);
    process.stdout.write(
      `legacy orders: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors\n`,
    );
    for (const e of result.errors) process.stderr.write(`  ! ${e}\n`);
    return result.errors.length > 0 ? 3 : 0;
  } finally {
    await seedDb.close();
  }
}

if (process.argv[1] && /legacy-orders\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(String(err instanceof Error ? (err.stack ?? err.message) : err) + "\n");
      process.exit(3);
    },
  );
}
