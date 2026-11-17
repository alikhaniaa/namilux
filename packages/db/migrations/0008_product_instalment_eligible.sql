-- 0008_product_instalment_eligible - a per-product "may be bought in instalments" switch.
--   Until now every product with a price was purchasable on the instalment storefront (SnappPay);
--   the only gate was SnappPay's own per-basket amount check. The admin now decides per product.
--   • products.instalment_eligible   false = the instalment site does not advertise instalments
--     for it, refuses to quote/place a basket that contains it, and the eligibility endpoint says
--     which product(s) block the basket. Card purchase on the main site never reads it.
--   ADDITIVE ONLY. `DEFAULT true NOT NULL` fills every existing row with true in the same
--   statement, so each product keeps exactly the availability it had before the migration, and
--   code that predates the column (an older build still running during a deploy) keeps working - 
--   it never names the column and inserts get the default.
--   Rollback, if ever needed: ALTER TABLE "products" DROP COLUMN "instalment_eligible";
--
--   GRANTS. nl_web reads `products` through an explicit COLUMN list (cost_price is withheld) and
--   nl_admin updates it through one too, so a new column is invisible to both until roles.sql
--   (which lists it) is re-applied - release.sh runs `pnpm db:roles` right after `db:migrate`.
--   The guarded block below grants exactly the two new column privileges here as well, so a
--   database that is migrated without the roles step (a restore, a hand-run migrate) is never left
--   with a storefront that gets 42501 on its first quote. Same least privilege as roles.sql: web
--   may READ it, admin may UPDATE it (admin already SELECTs the whole table; worker already SELECTs
--   the whole table and never writes it). Skipped where the roles do not exist yet - roles.sql
--   creates them and grants the same thing.
--
-- DEPENDS ON  0001_init (table products)
ALTER TABLE "products" ADD COLUMN "instalment_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- MANUAL: column grants for the pre-existing application roles (see GRANTS above).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_web') THEN
    GRANT SELECT ("instalment_eligible") ON "products" TO nl_web;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_admin') THEN
    GRANT UPDATE ("instalment_eligible") ON "products" TO nl_admin;
  END IF;
END
$$;
