--
-- WHAT
--   The initial schema migration: drizzle-kit's generated DDL for every table/enum/index/check/view
--   of packages/db/src/schema/*, followed by the hand-written additions drizzle-kit cannot express.
--   At M0 the implementer ran `pnpm --filter @namilux/db generate --name init`, opened the produced
--   `0001_init.sql`, pasted this header on top, kept the generated DDL, applied the EDITS below, and
--   appended the MANUAL sections. The placeholder file it replaced is gone (drizzle-kit names its
--   file identically, so it was simply overwritten).
--
-- CONTRACT - what the final 0001_init.sql MUST contain, in order:
--   [G] generated DDL (enums, tables, FKs, indexes, checks, view) - reviewed line by line against the spec
--   [E1] EDIT: replace the generated `CREATE TABLE "events" (…)` with the PARTITION BY RANGE version (MANUAL §1);
--        keep the generated indexes on "events" (partitioned indexes propagate to partitions) - APPLIED
--   [E2] VERIFY: `products.search_text`, `products.is_on_request`, `posts.search_text` are
--        `GENERATED ALWAYS AS (…) STORED` with the expressions of the schema files; if drizzle-kit emitted
--        plain columns, fix by hand (DROP + ADD COLUMN … GENERATED) - VERIFIED
--   [E3] VERIFY: the two GIN indexes use `gin_trgm_ops` (products_search_text_trgm_idx, posts_search_text_trgm_idx)
-- - VERIFIED
--   [E4] VERIFY: partial unique indexes carry their WHERE clauses (product_categories_primary_uq,
--        product_images_primary_uq, addresses_default_uq, back_in_stock_waiting_uq, price_alerts_waiting_uq,
--        payments_authority_uq, payments_one_succeeded_per_order_uq, orders_invoice_uq, jobs_unique_key_uq)
--        and categories_parent_slug_uq has NULLS NOT DISTINCT - VERIFIED
--   [M1] MANUAL: events partitioning + nl_events_ensure_partitions / nl_events_drop_old_partitions
--   [M2] MANUAL: updated_at triggers on every mutable table
--   [M3] MANUAL: stock_qty maintenance trigger (inventory_movements → products.stock_qty)
--   [M4] MANUAL: points_balance maintenance trigger (loyalty_ledger → customers.points_balance)
--   [M5] MANUAL: function privileges (REVOKE from PUBLIC; roles.sql grants EXECUTE to nl_worker)
--   Then: `pnpm --filter @namilux/db check` passes and `drizzle-kit generate` reports no diff.
--
-- RULES
--   - Additive-only after launch. This file is never edited after it has run in production.
--   - Every statement is separated by drizzle's breakpoint marker line (migrations/README.md §3).
--   - Trigger functions that write to other tables are SECURITY DEFINER with `SET search_path = public`
--     and owned by nl_migrate, so nl_web (which cannot UPDATE products/customers directly) still
--     maintains the caches through the ledgers - the only write path to stock_qty/points_balance.
--   - Seed (packages/seed) sets initial stock by inserting `inventory_movements(reason='seed')` rows,
--     never by writing products.stock_qty (the trigger applies them; inv. 5 holds from day one).
--
-- DECISION: the literal text of drizzle's breakpoint marker must never appear inside this header.
--   `readMigrationFiles` splits the WHOLE file on that string, comments included, so a marker quoted
--   in prose would cut a comment in half and make the remainder a syntax error. The placeholder
--   header quoted it in RULES; that one line is reworded above and nothing else changed.
--
-- EDGE CASES
--   - Inserting an event outside every partition → error; scripts/migrate.ts calls
--     nl_events_ensure_partitions(2) after every migration run and the worker calls it daily.
--   - nl_events_drop_old_partitions keeps the current month plus the previous 13.
--   - The updated_at trigger on products/posts ignores stock_qty/view_count/rating_* so sitemap
--     lastmod moves only on real edits.
--
-- TESTS
--   packages/db/src/__tests__/migrations.test.ts: "every mutable table has the set_updated_at trigger",
--     "products.search_text and posts.search_text are generated stored columns with GIN trgm indexes",
--     "events is partitioned by month after migrate", "nl_events_ensure_partitions creates next months",
--     "nl_events_drop_old_partitions keeps 13 months", "nl_apply_inventory_movement is SECURITY DEFINER and owned by nl_migrate",
--     "nl_apply_loyalty_delta is SECURITY DEFINER and owned by nl_migrate"
--   packages/db/src/__tests__/schema.test.ts: "inventory movement trigger updates stock_qty", "ledger trigger updates points_balance"
--
-- DEPENDS ON
--   0000_extensions.sql (nl_fa_norm, nl_set_updated_at)

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [G] generated DDL - `drizzle-kit generate --name init` (enums → tables → FKs → indexes → checks → view)
--     with edits E1–E4 of the CONTRACT above applied inside this block.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- [E2] nl_text_join - the immutable text[] join the posts.search_text generated column needs.
--      PostgreSQL marks concat_ws/array_to_string STABLE (they call type output functions), and a
--      GENERATED … STORED expression must be IMMUTABLE, so the schema files' concat_ws/array_to_string
--      expressions are replaced here by || / coalesce (products) and by this wrapper (posts). Same
--      strings, byte for byte.
CREATE OR REPLACE FUNCTION nl_text_join(parts text[], sep text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT array_to_string(parts, sep)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION nl_text_join(text[], text) IS 'IMMUTABLE wrapper over array_to_string so text[] columns can feed GENERATED … STORED expressions.';
--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('staff', 'customer', 'system', 'worker');--> statement-breakpoint
CREATE TYPE "public"."attribute_kind" AS ENUM('text', 'number', 'bool', 'color');--> statement-breakpoint
CREATE TYPE "public"."banner_slot" AS ENUM('promo_bar', 'home_hero', 'home_band', 'category_tile', 'plp_inline', 'pdp_band', 'ig_landing');--> statement-breakpoint
CREATE TYPE "public"."banner_theme" AS ENUM('light', 'dark', 'auto');--> statement-breakpoint
CREATE TYPE "public"."category_status" AS ENUM('active', 'hidden', 'archived');--> statement-breakpoint
CREATE TYPE "public"."collection_kind" AS ENUM('group', 'sub', 'campaign', 'gift', 'season');--> statement-breakpoint
CREATE TYPE "public"."collection_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."coupon_kind" AS ENUM('percent', 'fixed', 'free_shipping');--> statement-breakpoint
CREATE TYPE "public"."customer_tier" AS ENUM('member', 'silver', 'gold', 'diamond');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('female', 'male');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."loyalty_reason" AS ENUM('earn', 'redeem', 'expire', 'adjust', 'referral', 'birthday', 'review');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'video', 'file');--> statement-breakpoint
CREATE TYPE "public"."media_source" AS ENUM('legacy', 'admin', 'seed');--> statement-breakpoint
CREATE TYPE "public"."movement_reason" AS ENUM('sale', 'restock', 'adjust', 'return', 'cancel', 'seed');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('web', 'admin', 'phone', 'instagram', 'whatsapp', 'store');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'checkout', 'verify_phone', 'back_in_stock');--> statement-breakpoint
CREATE TYPE "public"."page_template" AS ENUM('default', 'contact', 'store', 'warranty', 'returns', 'installments', 'faq', 'privacy', 'terms');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'redirected', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."price_basis" AS ENUM('manual', 'fx');--> statement-breakpoint
CREATE TYPE "public"."product_image_role" AS ENUM('primary', 'gallery', 'editorial');--> statement-breakpoint
CREATE TYPE "public"."product_relation_kind" AS ENUM('related', 'accessory', 'replacement', 'same_model');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."product_visibility" AS ENUM('public', 'hidden', 'link_only');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('question', 'price', 'contact');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('pending', 'answered', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."redirect_source" AS ENUM('legacy', 'manual', 'auto_archive');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'rewarded');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."shipment_carrier" AS ENUM('post', 'tipax', 'courier', 'pickup', 'other');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('preparing', 'shipped', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."shipping_kind" AS ENUM('free', 'flat', 'by_province', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."stock_policy" AS ENUM('track', 'untracked');--> statement-breakpoint
CREATE TYPE "public"."stock_request_status" AS ENUM('waiting', 'notified', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ua_class" AS ENUM('mobile', 'desktop', 'inapp', 'pwa');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"label" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"province" text NOT NULL,
	"city" text NOT NULL,
	"address" text NOT NULL,
	"plaque" text,
	"unit" text,
	"postcode" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"geo_lat" numeric,
	"geo_lng" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_postcode_10_digits" CHECK (postcode ~ '^[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"first_name" text,
	"last_name" text,
	"email" text,
	"birthday" date,
	"gender" "gender",
	"tier" "customer_tier" DEFAULT 'member' NOT NULL,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by_id" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"admin_note" text,
	"last_login_at" timestamp with time zone,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"lifetime_spend" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_format" CHECK (phone ~ '^(09[0-9]{9}|del_[0-9A-HJKMNP-TV-Z]{26})$'),
	CONSTRAINT "customers_lifetime_spend_nonneg" CHECK (lifetime_spend >= 0),
	CONSTRAINT "customers_orders_count_nonneg" CHECK (orders_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"ua_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts_nonneg" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"ua" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"sudo_until" timestamp with time zone,
	"ip" "inet",
	"ua" text
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"role_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"credential_id" "bytea" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" text,
	"kind" "attribute_kind" DEFAULT 'text' NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_comparable" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"logo_media_id" text,
	"story_html" text,
	"claim" text,
	"seo_title" text,
	"seo_description" text,
	"robots" text DEFAULT 'index, follow' NOT NULL,
	"legacy_lastmod" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"description_html" text,
	"seo_title" text,
	"seo_description" text,
	"robots" text DEFAULT 'index, follow' NOT NULL,
	"in_sitemap" boolean DEFAULT true NOT NULL,
	"legacy_lastmod" timestamp with time zone,
	"status" "category_status" DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_parent_slug_uq" UNIQUE NULLS NOT DISTINCT("parent_id","slug")
);
--> statement-breakpoint
CREATE TABLE "collection_products" (
	"collection_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_products_collection_id_product_id_pk" PRIMARY KEY("collection_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"kind" "collection_kind" NOT NULL,
	"rule_json" jsonb,
	"cover_media_id" text,
	"cover_dark_media_id" text,
	"description_html" text,
	"seo_title" text,
	"seo_description" text,
	"is_nav" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" "collection_status" DEFAULT 'draft' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_window_valid" CHECK (starts_at is null or ends_at is null or starts_at < ends_at)
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"alt" text DEFAULT '' NOT NULL,
	"lqip" text,
	"renditions_json" jsonb,
	"normalize_json" jsonb,
	"uploaded_by_staff_id" text,
	"source" "media_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_bytes_nonneg" CHECK (bytes >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_attribute_values" (
	"product_id" integer NOT NULL,
	"attribute_id" integer NOT NULL,
	"value_text" text,
	"value_num" numeric,
	CONSTRAINT "product_attribute_values_product_id_attribute_id_pk" PRIMARY KEY("product_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"product_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "product_categories_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"media_id" text NOT NULL,
	"role" "product_image_role" DEFAULT 'gallery' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"brand_id" integer,
	"primary_product_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_relations" (
	"product_id" integer NOT NULL,
	"related_id" integer NOT NULL,
	"kind" "product_relation_kind" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_relations_product_id_related_id_kind_pk" PRIMARY KEY("product_id","related_id","kind"),
	CONSTRAINT "product_relations_not_self" CHECK (product_id <> related_id)
);
--> statement-breakpoint
CREATE TABLE "product_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"group_name" text,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" integer,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"brand_id" integer,
	"sku" text,
	"model_code" text,
	"color_name" text,
	"color_hex" text,
	"swatch_media_id" text,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"visibility" "product_visibility" DEFAULT 'public' NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"compare_at_price" bigint,
	"cost_price" bigint,
	"price_basis" "price_basis" DEFAULT 'manual' NOT NULL,
	"base_price" numeric,
	"base_currency" text,
	"price_updated_at" timestamp with time zone,
	"stock_policy" "stock_policy" DEFAULT 'track' NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"allow_backorder" boolean DEFAULT false NOT NULL,
	"low_stock_threshold" integer DEFAULT 3 NOT NULL,
	"max_per_order" integer DEFAULT 5 NOT NULL,
	"short_html" text,
	"description_html" text,
	"warranty_months" integer,
	"warranty_text" text,
	"weight_g" integer,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"video_media_id" text,
	"seo_title" text,
	"seo_description" text,
	"robots" text DEFAULT 'index, follow' NOT NULL,
	"legacy_lastmod" timestamp with time zone,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"is_on_request" boolean GENERATED ALWAYS AS (price = 0) STORED NOT NULL,
	"search_text" text GENERATED ALWAYS AS (nl_fa_norm(display_name || ' ' || name || coalesce(' ' || sku, '') || coalesce(' ' || model_code, '') || coalesce(' ' || color_name, ''))) STORED NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_nonneg" CHECK (price >= 0),
	CONSTRAINT "products_compare_at_nonneg" CHECK (compare_at_price is null or compare_at_price >= 0),
	CONSTRAINT "products_cost_nonneg" CHECK (cost_price is null or cost_price >= 0),
	CONSTRAINT "products_max_per_order_pos" CHECK (max_per_order >= 1),
	CONSTRAINT "products_low_stock_nonneg" CHECK (low_stock_threshold >= 0),
	CONSTRAINT "products_rating_range" CHECK (rating_avg >= 0 and rating_avg <= 5)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"reason" "movement_reason" NOT NULL,
	"order_id" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_delta_nonzero" CHECK (delta <> 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"order_id" text NOT NULL,
	"qty" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_qty_pos" CHECK (qty >= 1),
	CONSTRAINT "inventory_reservations_single_outcome" CHECK (not (released_at is not null and consumed_at is not null))
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"model_code" text,
	"color_name" text,
	"image_key" text,
	"unit_price" bigint NOT NULL,
	"compare_at_price" bigint,
	"qty" integer NOT NULL,
	"line_total" bigint NOT NULL,
	"warranty_months" integer,
	CONSTRAINT "order_items_qty_pos" CHECK (qty >= 1),
	CONSTRAINT "order_items_unit_price_pos" CHECK (unit_price > 0),
	CONSTRAINT "order_items_line_total_formula" CHECK (line_total = unit_price * qty)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"invoice_year" smallint,
	"invoice_no" integer,
	"customer_id" text,
	"phone" text NOT NULL,
	"email" text,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"source" "order_source" DEFAULT 'web' NOT NULL,
	"channel_ref" text,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"shipping_total" bigint DEFAULT 0 NOT NULL,
	"points_discount" bigint DEFAULT 0 NOT NULL,
	"grand_total" bigint DEFAULT 0 NOT NULL,
	"coupon_id" integer,
	"coupon_code" text,
	"points_redeemed" integer DEFAULT 0 NOT NULL,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"shipping_method_key" text,
	"shipping_snapshot_json" jsonb,
	"address_snapshot_json" jsonb,
	"customer_note" text,
	"admin_note" text,
	"gift_message" text,
	"is_gift" boolean DEFAULT false NOT NULL,
	"ip" "inet",
	"ua" text,
	"utm_json" jsonb,
	"placed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_code_format" CHECK (code ~ '^NL-[A-Z0-9]{5}$'),
	CONSTRAINT "orders_terms_nonneg" CHECK (subtotal >= 0 and discount_total >= 0 and shipping_total >= 0 and points_discount >= 0 and grand_total >= 0),
	CONSTRAINT "orders_grand_total_formula" CHECK (grand_total = subtotal - discount_total - points_discount + shipping_total),
	CONSTRAINT "orders_points_nonneg" CHECK (points_redeemed >= 0 and points_earned >= 0),
	CONSTRAINT "orders_invoice_pair" CHECK ((invoice_no is null and invoice_year is null) or (invoice_no is not null and invoice_year is not null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"driver" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"authority" text,
	"ref_id" text,
	"card_pan_masked" text,
	"fee" bigint,
	"raw_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "payments_amount_pos" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"provider_ref" text,
	"by_staff_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "refunds_amount_pos" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"carrier" "shipment_carrier" NOT NULL,
	"tracking_code" text,
	"tracking_url" text,
	"status" "shipment_status" DEFAULT 'preparing' NOT NULL,
	"cost" bigint,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"cart_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_cart_id_product_id_pk" PRIMARY KEY("cart_id","product_id"),
	CONSTRAINT "cart_items_qty_pos" CHECK (qty >= 1)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_amount_nonneg" CHECK (amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" "coupon_kind" NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"min_subtotal" bigint DEFAULT 0 NOT NULL,
	"max_discount" bigint,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"usage_per_customer" integer DEFAULT 1 NOT NULL,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"customer_id" text,
	"applies_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"excludes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stackable_with_points" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_staff_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_upper" CHECK (code = upper(code)),
	CONSTRAINT "coupons_value_nonneg" CHECK (value >= 0),
	CONSTRAINT "coupons_min_subtotal_nonneg" CHECK (min_subtotal >= 0),
	CONSTRAINT "coupons_usage_per_customer_pos" CHECK (usage_per_customer >= 1),
	CONSTRAINT "coupons_window_valid" CHECK (starts_at is null or ends_at is null or starts_at < ends_at)
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "shipping_kind" NOT NULL,
	"rate_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provinces" text[],
	"eta_min_days" integer DEFAULT 0 NOT NULL,
	"eta_max_days" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_eta_valid" CHECK (eta_min_days >= 0 and eta_max_days >= eta_min_days)
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"customer_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlists_customer_id_product_id_pk" PRIMARY KEY("customer_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" "loyalty_reason" NOT NULL,
	"order_id" text,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_delta_nonzero" CHECK (delta <> 0)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL,
	"referee_id" text NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_not_self" CHECK (referrer_id <> referee_id)
);
--> statement-breakpoint
CREATE TABLE "back_in_stock_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"phone" text NOT NULL,
	"customer_id" text,
	"status" "stock_request_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "back_in_stock_phone_format" CHECK (phone ~ '^09[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"phone" text NOT NULL,
	"customer_id" text,
	"target_price" bigint NOT NULL,
	"status" "stock_request_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "price_alerts_target_pos" CHECK (target_price > 0),
	CONSTRAINT "price_alerts_phone_format" CHECK (phone ~ '^09[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "question_kind" DEFAULT 'question' NOT NULL,
	"product_id" integer,
	"customer_id" text,
	"name" text,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"answer" text,
	"status" "question_status" DEFAULT 'pending' NOT NULL,
	"answered_by_staff_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "questions_product_by_kind" CHECK ((kind = 'contact' and product_id is null) or (kind <> 'contact' and product_id is not null)),
	CONSTRAINT "questions_phone_format" CHECK (phone ~ '^09[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"customer_id" text NOT NULL,
	"order_id" text,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"pros" text[],
	"cons" text[],
	"is_verified_purchase" boolean DEFAULT false NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"admin_reply" text,
	"replied_at" timestamp with time zone,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK (rating between 1 and 5),
	CONSTRAINT "reviews_helpful_nonneg" CHECK (helpful_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot" "banner_slot" NOT NULL,
	"title" text,
	"subtitle" text,
	"cta_label" text,
	"cta_href" text,
	"media_light_id" text,
	"media_dark_id" text,
	"theme" "banner_theme" DEFAULT 'auto' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"targeting_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banners_window_valid" CHECK (starts_at is null or ends_at is null or starts_at < ends_at)
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_key" text NOT NULL,
	"question" text NOT NULL,
	"answer_html" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"items_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"template" "page_template" DEFAULT 'default' NOT NULL,
	"status" "content_status" DEFAULT 'published' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"robots" text DEFAULT 'index, follow' NOT NULL,
	"legacy_lastmod" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body_html" text DEFAULT '' NOT NULL,
	"cover_media_id" text,
	"author_staff_id" text,
	"author_name" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"legacy_lastmod" timestamp with time zone,
	"seo_title" text,
	"seo_description" text,
	"robots" text DEFAULT 'index, follow' NOT NULL,
	"read_minutes" integer DEFAULT 0 NOT NULL,
	"related_product_ids" integer[],
	"search_text" text GENERATED ALWAYS AS (nl_fa_norm(title || coalesce(' ' || excerpt, '') || coalesce(' ' || nl_text_join(tags, ' '), ''))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"code" smallint DEFAULT 301 NOT NULL,
	"source" "redirect_source" NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_code_valid" CHECK (code in (301, 410)),
	CONSTRAINT "redirects_from_path_leading_slash" CHECK (from_path like '/%'),
	CONSTRAINT "redirects_hits_nonneg" CHECK (hits >= 0)
);
--> statement-breakpoint
CREATE TABLE "seo_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"path" text NOT NULL,
	"status" smallint,
	"title" text,
	"description" text,
	"canonical" text,
	"robots" text,
	"h1" text,
	"schema_types" text[],
	"crawled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- [E1] partitioned by month; the generated indexes below propagate to every partition.
CREATE TABLE "events" (
	"id" bigserial NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"path" text NOT NULL,
	"ref" text,
	"product_id" integer,
	"session_hash" text NOT NULL,
	"ua_class" "ua_class" NOT NULL,
	"props_json" jsonb,
	CONSTRAINT "events_pk" PRIMARY KEY("id","ts")
) PARTITION BY RANGE ("ts");
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"unique_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_attempts_nonneg" CHECK (attempts >= 0 and max_attempts >= 1)
);
--> statement-breakpoint
CREATE TABLE "metrics_daily" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"dim" text DEFAULT '' NOT NULL,
	"value" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "metrics_daily_pk" PRIMARY KEY("day","metric","dim")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_count_nonneg" CHECK (count >= 0)
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ip" "inet",
	"actor" text,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_log" (
	"id" text PRIMARY KEY NOT NULL,
	"to_masked" text NOT NULL,
	"to_hash" text NOT NULL,
	"template" text NOT NULL,
	"provider" text NOT NULL,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"cost" bigint,
	"error" text,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_log_to_masked_no_full_number" CHECK (to_masked !~ '^09[0-9]{9}$')
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_referred_by_id_customers_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."staff_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_parent_id_collections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_cover_dark_media_id_media_id_fk" FOREIGN KEY ("cover_dark_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_staff_id_staff_users_id_fk" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_models" ADD CONSTRAINT "product_models_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_models" ADD CONSTRAINT "product_models_primary_product_id_products_id_fk" FOREIGN KEY ("primary_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_related_id_products_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_specs" ADD CONSTRAINT "product_specs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_model_id_product_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."product_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_swatch_media_id_media_id_fk" FOREIGN KEY ("swatch_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_video_media_id_media_id_fk" FOREIGN KEY ("video_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_by_staff_id_staff_users_id_fk" FOREIGN KEY ("by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_customers_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_customers_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answered_by_staff_id_staff_users_id_fk" FOREIGN KEY ("answered_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_media_light_id_media_id_fk" FOREIGN KEY ("media_light_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_media_dark_id_media_id_fk" FOREIGN KEY ("media_dark_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_staff_id_staff_users_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_customer_id_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_default_uq" ON "addresses" USING btree ("customer_id") WHERE is_default;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_uq" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_referral_code_uq" ON "customers" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "customers_tier_idx" ON "customers" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customers_referred_by_id_idx" ON "customers" USING btree ("referred_by_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_type","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_created_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_customer_id_idx" ON "sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_name_uq" ON "staff_roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_token_hash_uq" ON "staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_id_idx" ON "staff_sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_idle_expires_at_idx" ON "staff_sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_lower_uq" ON "staff_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "staff_users_role_id_idx" ON "staff_users" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_uq" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_staff_id_idx" ON "webauthn_credentials" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_key_uq" ON "attributes" USING btree ("key");--> statement-breakpoint
CREATE INDEX "attributes_sort_idx" ON "attributes" USING btree ("sort");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_uq" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "brands_active_sort_idx" ON "brands" USING btree ("is_active","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_path_uq" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_status_sort_idx" ON "categories" USING btree ("status","sort");--> statement-breakpoint
CREATE INDEX "collection_products_product_id_idx" ON "collection_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_uq" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collections_parent_id_idx" ON "collections" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "collections_status_kind_sort_idx" ON "collections" USING btree ("status","kind","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_uq" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_kind_idx" ON "media" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "media_source_idx" ON "media" USING btree ("source");--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "price_history_product_created_idx" ON "price_history" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "product_attribute_values_attr_text_idx" ON "product_attribute_values" USING btree ("attribute_id","value_text");--> statement-breakpoint
CREATE INDEX "product_attribute_values_attr_num_idx" ON "product_attribute_values" USING btree ("attribute_id","value_num");--> statement-breakpoint
CREATE INDEX "product_categories_category_id_idx" ON "product_categories" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_primary_uq" ON "product_categories" USING btree ("product_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "product_images_product_sort_idx" ON "product_images" USING btree ("product_id","sort");--> statement-breakpoint
CREATE INDEX "product_images_media_id_idx" ON "product_images" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_primary_uq" ON "product_images" USING btree ("product_id") WHERE role = 'primary';--> statement-breakpoint
CREATE UNIQUE INDEX "product_models_key_uq" ON "product_models" USING btree ("key");--> statement-breakpoint
CREATE INDEX "product_models_brand_id_idx" ON "product_models" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "product_relations_related_id_idx" ON "product_relations" USING btree ("related_id");--> statement-breakpoint
CREATE INDEX "product_specs_product_sort_idx" ON "product_specs" USING btree ("product_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_search_text_trgm_idx" ON "products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_brand_id_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_model_id_idx" ON "products" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "products_status_visibility_idx" ON "products" USING btree ("status","visibility");--> statement-breakpoint
CREATE INDEX "products_price_idx" ON "products" USING btree ("price");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_published_at_idx" ON "products" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_created_idx" ON "inventory_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_product_idx" ON "inventory_reservations" USING btree ("product_id") WHERE released_at is null and consumed_at is null;--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_expires_idx" ON "inventory_reservations" USING btree ("expires_at") WHERE released_at is null and consumed_at is null;--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_id_idx" ON "inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_created_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_code_uq" ON "orders" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_invoice_uq" ON "orders" USING btree ("invoice_year","invoice_no") WHERE invoice_no is not null;--> statement-breakpoint
CREATE INDEX "orders_customer_placed_idx" ON "orders" USING btree ("customer_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "orders_placed_at_idx" ON "orders" USING btree ("placed_at");--> statement-breakpoint
CREATE INDEX "orders_pending_expires_idx" ON "orders" USING btree ("expires_at") WHERE status = 'pending_payment';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_authority_uq" ON "payments" USING btree ("authority") WHERE authority is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_succeeded_per_order_uq" ON "payments" USING btree ("order_id") WHERE status = 'succeeded';--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_status_created_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "refunds_order_id_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "shipments_order_id_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cart_items_product_id_idx" ON "cart_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_customer_id_uq" ON "carts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_order_id_uq" ON "coupon_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_customer_coupon_idx" ON "coupon_redemptions" USING btree ("customer_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_active_ends_idx" ON "coupons" USING btree ("is_active","ends_at");--> statement-breakpoint
CREATE INDEX "coupons_customer_id_idx" ON "coupons" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_methods_key_uq" ON "shipping_methods" USING btree ("key");--> statement-breakpoint
CREATE INDEX "shipping_methods_active_sort_idx" ON "shipping_methods" USING btree ("is_active","sort");--> statement-breakpoint
CREATE INDEX "wishlists_product_id_idx" ON "wishlists" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer_created_idx" ON "loyalty_ledger" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_order_id_idx" ON "loyalty_ledger" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_expires_at_idx" ON "loyalty_ledger" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_id_uq" ON "referrals" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_id_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "back_in_stock_waiting_uq" ON "back_in_stock_requests" USING btree ("product_id","phone") WHERE status = 'waiting';--> statement-breakpoint
CREATE INDEX "back_in_stock_product_status_idx" ON "back_in_stock_requests" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "back_in_stock_phone_idx" ON "back_in_stock_requests" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_waiting_uq" ON "price_alerts" USING btree ("product_id","phone") WHERE status = 'waiting';--> statement-breakpoint
CREATE INDEX "price_alerts_product_status_idx" ON "price_alerts" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "questions_status_created_idx" ON "questions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "questions_kind_status_idx" ON "questions" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "questions_product_id_idx" ON "questions" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_product_customer_uq" ON "reviews" USING btree ("product_id","customer_id");--> statement-breakpoint
CREATE INDEX "reviews_product_status_created_idx" ON "reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_status_created_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "banners_slot_active_sort_idx" ON "banners" USING btree ("slot","is_active","sort");--> statement-breakpoint
CREATE INDEX "faqs_group_sort_idx" ON "faqs" USING btree ("group_key","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "menus_key_uq" ON "menus" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_uq" ON "pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_uq" ON "posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "posts_search_text_trgm_idx" ON "posts" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "posts_status_published_idx" ON "posts" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_updated_at_idx" ON "posts" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "redirects_from_path_uq" ON "redirects" USING btree ("from_path");--> statement-breakpoint
CREATE INDEX "redirects_active_idx" ON "redirects" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "seo_snapshots_run_path_idx" ON "seo_snapshots" USING btree ("run_id","path");--> statement-breakpoint
CREATE INDEX "seo_snapshots_path_crawled_idx" ON "seo_snapshots" USING btree ("path","crawled_at");--> statement-breakpoint
CREATE INDEX "events_ts_idx" ON "events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "events_type_ts_idx" ON "events" USING btree ("type","ts");--> statement-breakpoint
CREATE INDEX "events_type_path_ts_idx" ON "events" USING btree ("type","path","ts");--> statement-breakpoint
CREATE INDEX "events_product_ts_idx" ON "events" USING btree ("product_id","ts") WHERE product_id is not null;--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "jobs_running_locked_at_idx" ON "jobs" USING btree ("locked_at") WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_unique_key_uq" ON "jobs" USING btree ("unique_key") WHERE unique_key is not null;--> statement-breakpoint
CREATE INDEX "metrics_daily_metric_day_idx" ON "metrics_daily" USING btree ("metric","day");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "security_events_kind_created_idx" ON "security_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "security_events_created_at_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_log_created_at_idx" ON "sms_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_log_to_hash_created_idx" ON "sms_log" USING btree ("to_hash","created_at");--> statement-breakpoint
CREATE INDEX "sms_log_order_id_idx" ON "sms_log" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sms_log_template_created_idx" ON "sms_log" USING btree ("template","created_at");--> statement-breakpoint
CREATE VIEW "public"."brand_product_counts" AS (select "brand_id", count(*)::int as "total", count(*) filter (where "price" > 0 and "stock_qty" > 0)::int as "buyable" from "products" where ("products"."status" = 'active' and "products"."visibility" = 'public') group by "products"."brand_id");
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [M1] events: partition maintenance (the partitioned CREATE TABLE + its indexes are in [G] above)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION nl_events_ensure_partitions(months_ahead integer DEFAULT 2) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  first_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  m date;
  part_name text;
  created integer := 0;
BEGIN
  IF months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24';
  END IF;
  FOR i IN 0..months_ahead LOOP
    m := (first_month + make_interval(months => i))::date;
    part_name := 'events_' || to_char(m, 'YYYYMM');
    IF to_regclass('public.' || part_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
        part_name,
        (m::timestamp AT TIME ZONE 'UTC'),
        ((m + interval '1 month')::timestamp AT TIME ZONE 'UTC')
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION nl_events_drop_old_partitions(retain_months integer DEFAULT 13) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cutoff date := (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => retain_months))::date;
  r record;
  dropped integer := 0;
BEGIN
  IF retain_months < 1 THEN
    RAISE EXCEPTION 'retain_months must be >= 1';
  END IF;
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'public' AND p.relname = 'events' AND c.relname ~ '^events_[0-9]{6}$'
  LOOP
    IF to_date(substr(r.relname, 8, 6), 'YYYYMM') < cutoff THEN
      EXECUTE format('DROP TABLE %I', r.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END
$$;
--> statement-breakpoint
SELECT nl_events_ensure_partitions(2);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [M2] updated_at triggers (function nl_set_updated_at from 0000_extensions.sql)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brands', 'categories', 'collections', 'product_models', 'attributes', 'media',
    'customers', 'addresses', 'staff_roles', 'staff_users',
    'carts', 'shipping_methods', 'coupons', 'orders', 'shipments', 'reviews',
    'pages', 'faqs', 'menus', 'banners', 'redirects', 'settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION nl_set_updated_at()',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON products;
--> statement-breakpoint
-- DECISION (M0): 'search_text' and 'is_on_request' are in the ignore list because they are
-- GENERATED ALWAYS columns, and inside a BEFORE trigger a generated column is NULL in NEW while it
-- holds its value in OLD. Without them every UPDATE looks like a change, the TG_ARGV list has no
-- effect at all, and `update products set view_count = view_count + 1` moves updated_at -> sitemap
-- lastmod, which the spec forbids. Verified against the live database.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION nl_set_updated_at('stock_qty', 'view_count', 'rating_avg', 'rating_count', 'search_text', 'is_on_request');
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON posts;
--> statement-breakpoint
-- 'search_text' for the same reason as products above.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION nl_set_updated_at('search_text');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [M3] stock_qty = SUM(inventory_movements.delta) - maintained on INSERT (inv. 5, the spec)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--> statement-breakpoint
CREATE OR REPLACE FUNCTION nl_apply_inventory_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE products SET stock_qty = stock_qty + NEW.delta WHERE id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory movement for unknown product %', NEW.product_id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS apply_inventory_movement ON inventory_movements;
--> statement-breakpoint
CREATE TRIGGER apply_inventory_movement AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION nl_apply_inventory_movement();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [M4] points_balance = SUM(loyalty_ledger.delta) - maintained on INSERT (inv. 6)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--> statement-breakpoint
CREATE OR REPLACE FUNCTION nl_apply_loyalty_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE customers SET points_balance = points_balance + NEW.delta WHERE id = NEW.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'loyalty ledger row for unknown customer %', NEW.customer_id;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS apply_loyalty_delta ON loyalty_ledger;
--> statement-breakpoint
CREATE TRIGGER apply_loyalty_delta AFTER INSERT ON loyalty_ledger
  FOR EACH ROW EXECUTE FUNCTION nl_apply_loyalty_delta();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [M5] function privileges - roles.sql grants EXECUTE to the roles that need them
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--> statement-breakpoint
REVOKE ALL ON FUNCTION nl_events_ensure_partitions(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION nl_events_drop_old_partitions(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION nl_apply_inventory_movement() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION nl_apply_loyalty_delta() FROM PUBLIC;
