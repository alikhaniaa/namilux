import { createHash } from "node:crypto";
import { backInStock, jobs } from "@namilux/core";
import { eq, products } from "@namilux/db";
import type { Handler } from "../runtime";

export const stockBackInStock: Handler = async ({ db, log, job }) => {
  const productId = Number((job.payload as { productId?: unknown }).productId);
  if (!Number.isInteger(productId)) {
    log.warn({ jobId: job.id }, "stock-back-in-stock: bad productId");
    return;
  }

  const due = await backInStock.dueForProduct(db, productId);
  if (due.length === 0) return;

  const rows = await db
    .select({ name: products.displayName })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const product = rows[0];
  if (product === undefined) {
    log.warn({ productId }, "stock-back-in-stock: product not found");
    return;
  }

  // At-most-once: flip every waiting row to notified BEFORE any send is enqueued.
  await backInStock.markNotified(db, due.map((d) => d.id));

  const day = new Date().toISOString().slice(0, 10);
  for (const { phone } of due) {
    const phoneHash = createHash("sha256").update(phone).digest("hex").slice(0, 16);
    await jobs.enqueue(
      db,
      "sms.send",
      // lQEYf4nuBT declares `name` and nothing else: the product link was the reason FarazSMS
      // refused the old pattern, so the message names the product and stops there.
      { template: "product.back_in_stock", phone, productId, vars: { name: product.name } },
      { uniqueKey: `bis:${productId}:${phoneHash}:${day}` },
    );
  }

  log.info({ productId, notified: due.length }, "back-in-stock notifications enqueued");
};
