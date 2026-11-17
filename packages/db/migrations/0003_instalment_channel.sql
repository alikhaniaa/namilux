-- 0003_instalment_channel - the second storefront: an instalment price on every product and a
-- sales channel on every order and cart.
--   Two sites run the SAME code against THIS database. Everything is shared (products, stock,
--   customers, orders, admin, worker); only the price shown and the gateway offered differ.
--   • products.instalment_price      the price the instalment site shows. Derived from `price` on
--     every price write (core/pricing/instalments.deriveInstalmentPrice covers the SnappPay
--     merchant commission), unless a human pinned it - which is what `instalment_price_manual`
--     records. NULL means "never derived"; the resolver reads it as 0 = on request, like price 0.
--   • orders.channel / carts.channel which storefront the row belongs to. Existing rows are all
--     `main`, which is why the enum's first value and both defaults are `main`.
--   The carts unique index widens from (customer_id) to (customer_id, channel): one basket per
--   customer PER SITE, because the same product costs a different amount on each.
CREATE TYPE "public"."sales_channel" AS ENUM('main', 'instalments');--> statement-breakpoint
DROP INDEX "carts_customer_id_uq";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "instalment_price" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "instalment_price_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel" "sales_channel" DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "channel" "sales_channel" DEFAULT 'main' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_instalment_price_idx" ON "products" USING btree ("instalment_price");--> statement-breakpoint
CREATE INDEX "orders_channel_placed_idx" ON "orders" USING btree ("channel","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "carts_customer_channel_uq" ON "carts" USING btree ("customer_id","channel");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_instalment_price_nonneg" CHECK (instalment_price is null or instalment_price >= 0);--> statement-breakpoint
-- MANUAL: backfill with the DEFAULT rule (commission 10 %, rounded up to 10,000 Toman) so the
-- column is meaningful the moment the second site is switched on. Identical arithmetic to
-- `deriveInstalmentPrice`: ceil(price / (1 - commission/100) / roundTo) * roundTo, and 0 stays 0
-- (on request). Changing the rule in the panel re-derives every non-manual row
-- (core: recomputeInstalmentPrices), so this is a starting value, not a decision.
UPDATE "products"
   SET "instalment_price" = CASE
     WHEN "price" <= 0 THEN 0
     ELSE (ceil(("price"::numeric / (1 - 10::numeric / 100)) / 10000) * 10000)::bigint
   END
 WHERE "instalment_price" IS NULL;
