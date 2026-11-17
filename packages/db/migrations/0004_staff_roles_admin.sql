-- 0004_staff_roles_admin - the head-admin (owner) vs admin split.
--   • staff_roles gains the `admin` row (and every other row is refreshed) so a database seeded
--     before this release can have an admin assigned to it. `staff_users.role_id` points at these
--     rows by id, so the upsert is BY NAME and never deletes: an id in use must survive.
--     The permission list stored here is documentation and a mirror of
--     packages/core/src/authz/permissions.ts, which is what `staffResolve` actually reads - a stale
--     row can therefore no longer narrow the owner's access after a deploy that adds a permission.
--   • the six history columns that point at a staff member become ON DELETE SET NULL, so the owner
--     can delete an admin outright without losing the photo they uploaded or the order they moved.
--     Nothing is deleted by this migration; the constraints are only redefined.
ALTER TABLE "media" DROP CONSTRAINT "media_uploaded_by_staff_id_staff_users_id_fk";
--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_by_staff_id_staff_users_id_fk";
--> statement-breakpoint
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_created_by_staff_id_staff_users_id_fk";
--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT "questions_answered_by_staff_id_staff_users_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_author_staff_id_staff_users_id_fk";
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_staff_id_staff_users_id_fk" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_by_staff_id_staff_users_id_fk" FOREIGN KEY ("by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answered_by_staff_id_staff_users_id_fk" FOREIGN KEY ("answered_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_staff_id_staff_users_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- MANUAL: the role rows. `owner` already exists on every live database (create-owner/seed made it)
-- and keeps its id; `admin` is new. ON CONFLICT (name) DO UPDATE, never INSERT-only, so the lists
-- below also repair a database seeded by an older release.
INSERT INTO "staff_roles" ("name", "permissions") VALUES
  ('owner', '["catalog.read","catalog.write","catalog.price","catalog.cost","catalog.bulk","media.write","media.delete","orders.read","orders.write","orders.refund","orders.manual_payment","orders.create","customers.read","customers.write","customers.export","customers.points","inbox.read","inbox.reply","marketing.coupons","marketing.banners","marketing.sms","marketing.loyalty","content.write","seo.write","settings.read","settings.write","settings.money","settings.security","analytics.read","staff.manage","audit.read","system.jobs","system.cache"]'::jsonb),
  ('admin', '["catalog.read","catalog.write","catalog.price","catalog.bulk","media.write","media.delete","orders.read","orders.write","orders.refund","orders.manual_payment","orders.create","customers.read","customers.write","customers.points","inbox.read","inbox.reply","marketing.coupons","marketing.banners","marketing.sms","content.write","seo.write","settings.read","settings.write"]'::jsonb),
  ('manager', '["catalog.read","catalog.write","catalog.price","catalog.bulk","media.write","media.delete","orders.read","orders.write","orders.refund","orders.manual_payment","orders.create","customers.read","customers.write","customers.export","customers.points","inbox.read","inbox.reply","marketing.coupons","marketing.banners","marketing.sms","content.write","seo.write","settings.read","settings.write","audit.read","system.jobs","system.cache"]'::jsonb),
  ('orders', '["catalog.read","orders.read","orders.write","orders.create","customers.read","inbox.read","inbox.reply"]'::jsonb),
  ('content', '["catalog.read","catalog.write","media.write","marketing.banners","content.write","seo.write"]'::jsonb),
  ('support', '["catalog.read","orders.read","customers.read","customers.write","inbox.read","inbox.reply"]'::jsonb),
  ('viewer', '["catalog.read","orders.read","customers.read","inbox.read","settings.read","audit.read"]'::jsonb)
ON CONFLICT ("name") DO UPDATE SET "permissions" = excluded."permissions", "updated_at" = now();
--> statement-breakpoint
-- MANUAL: the grant that goes with the DELETE above. roles.sql carries the same line, but only a
-- `pnpm db:roles` applies that file and a release runs migrations alone - so the privilege is
-- granted here too, guarded because a test database may be migrated before the roles exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl_admin') THEN
    GRANT DELETE ON TABLE "staff_users" TO nl_admin;
  END IF;
END $$;
