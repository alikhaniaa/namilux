import { type Db, eq, inArray, productModels, products, sql } from "@namilux/db";
import type { Actor } from "../types";
import { audit } from "../audit";
import { appError } from "../errors";
import { collapseSpaces, faNorm } from "../persian";

export const COLOUR_TOKENS: readonly string[] = [
  "مشکی",
  "سفید",
  "قرمز",
  "کرم",
  "سبز",
  "آبی",
  "صورتی",
  "طوسی",
  "نقره‌ای",
  "مسی",
  "زرد",
  "بنفش",
  "نارنجی",
  "سرمه‌ای",
  "طلایی",
  "فوشیا",
  "براق",
  "مات",
  "پاستیلی",
  "رنگ",
];

// DECISION: the contract says "alternation of faNorm(token)" and the edge cases require the two
// spellings of a compound colour to collide. faNorm turns a ZWNJ into a SPACE, so the alternation
// carries BOTH normalized forms of every token ("نقره ای" and "نقرهای"), longest-first so a long
// token is never split by a shorter one ("رنگ" inside "نقرهای").
const NORMALIZED_COLOUR_TOKENS: readonly string[] = [
  ...new Set(COLOUR_TOKENS.flatMap((t) => [faNorm(t), faNorm(t.replace(/‌/g, ""))])),
].filter((t) => t !== "");

export const COLOUR_TOKENS_RE: RegExp = new RegExp(
  [...NORMALIZED_COLOUR_TOKENS].sort((a, b) => b.length - a.length).join("|"),
  "g",
);

/**
 * DECISION: the same alternation over the RAW tokens (both spellings, ZWNJ kept and removed). It is
 * never used for keying - only to build `product_models.display_name`, which rules define as the
 * base of the primary variant display name with the colour stripped, and which must stay readable
 * Persian (faNorm would lower-case the Latin model code and drop the ZWNJ an admin typed).
 */
const RAW_COLOUR_TOKENS_RE: RegExp = new RegExp(
  [...new Set([...COLOUR_TOKENS, ...COLOUR_TOKENS.map((t) => t.replace(/‌/g, ""))])]
    .sort((a, b) => b.length - a.length)
    .join("|"),
  "g",
);

export const DISPLAY_NAME_COLOUR_SEPARATOR = " · ";

export type ModelKeyInput = {
  name: string;
  displayName: string | null;
  sku: string | null;
  modelCode: string | null;
};

export type GroupCandidate = {
  id: number;
  brandId: number | null;
  key: string;
  available: boolean;
  priced: boolean;
  hasImage: boolean;
  displayName: string;
};

export type GroupPlan = {
  key: string;
  brandId: number | null;
  productIds: number[];
  primaryProductId: number;
  displayName: string;
};

/** Group rows an admin created by hand are never re-planned or re-pointed (rules). */
const MANUAL_KEY_PREFIX = "manual:";

// ---------------------------------------------------------------- the key (pure)

export function splitDisplayName(displayName: string): { base: string; colour: string | null } {
  const value = typeof displayName === "string" ? displayName : "";
  // rules: split at the LAST " · " - "[برند] [نوع] [مدل] · [رنگ]" (v2 §10.1); an earlier separator
  // belongs to the model name itself.
  const at = value.lastIndexOf(DISPLAY_NAME_COLOUR_SEPARATOR);
  if (at < 0) return { base: value.trim(), colour: null };
  const base = value.slice(0, at).trim();
  const colour = value.slice(at + DISPLAY_NAME_COLOUR_SEPARATOR.length).trim();
  // EDGE CASE: a trailing separator with nothing after it is not a colour.
  return { base, colour: colour === "" ? null : colour };
}

export function stripColourTokens(normalized: string): string {
  if (typeof normalized !== "string" || normalized === "") return "";
  return collapseSpaces(normalized.replace(COLOUR_TOKENS_RE, " "));
}

export function modelKey(p: ModelKeyInput): string {
  // DECISION: an empty / whitespace-only display_name counts as absent (the contract `?? name` only
  // catches null), so a legacy row with display_name = "" keys off its `name` instead of producing
  // the empty key that means "never group".
  const display =
    typeof p.displayName === "string" && p.displayName.trim() !== "" ? p.displayName : null;
  if (display !== null) {
    const { base, colour } = splitDisplayName(display);
    // rules (1): the separator already isolated the colour - the base is the key verbatim.
    if (colour !== null) return collapseSpaces(faNorm(base));
  }
  // rules (2): no separator → normalize and remove the colour words wherever they sit.
  // `sku` / `modelCode` are accepted by the input type but deliberately unused at launch (rules).
  return stripColourTokens(faNorm(display ?? p.name ?? ""));
}

// ---------------------------------------------------------------- grouping (pure)

/** rules: available&&priced&&hasImage → available&&priced → available → hasImage → lowest id. */
function primaryRank(m: GroupCandidate): number {
  if (m.available && m.priced && m.hasImage) return 0;
  if (m.available && m.priced) return 1;
  if (m.available) return 2;
  if (m.hasImage) return 3;
  return 4;
}

export function pickPrimaryVariant(members: GroupCandidate[]): number {
  let best: GroupCandidate | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const m of members) {
    const rank = primaryRank(m);
    // Ties break on the lowest id, so a re-run picks the same variant (idempotence).
    if (rank < bestRank || (rank === bestRank && best !== null && m.id < best.id)) {
      best = m;
      bestRank = rank;
    }
  }
  return best?.id ?? 0;
}

/** rules: `product_models.display_name` = the primary variant display name without the colour. */
function modelDisplayName(primary: GroupCandidate): string {
  const { base } = splitDisplayName(primary.displayName ?? "");
  const stripped = collapseSpaces(base.replace(RAW_COLOUR_TOKENS_RE, " "));
  if (stripped !== "") return stripped;
  return base === "" ? primary.displayName.trim() : base;
}

export function planGroups(rows: GroupCandidate[]): GroupPlan[] {
  const buckets = new Map<string, GroupCandidate[]>();
  for (const row of rows) {
    // rules: an empty key (the name was only colour words) is never grouped.
    if (row.key === "") continue;
    // DECISION: `brandId` is part of the bucket identity and null is one of its values - rules say a
    // product with no brand never groups ACROSS brands, not that it never groups; two brandless
    // variants of one model (33 legacy rows carry no brand) still deserve one swatch set.
    const bucket = `${row.brandId ?? "none"}\x00${row.key}`;
    const found = buckets.get(bucket);
    if (found === undefined) buckets.set(bucket, [row]);
    else found.push(row);
  }

  const plans: GroupPlan[] = [];
  for (const members of buckets.values()) {
    // rules: a group needs at least 2 products; a single-member key gets model_id NULL.
    if (members.length < 2) continue;
    const primaryProductId = pickPrimaryVariant(members);
    const primary = members.find((m) => m.id === primaryProductId) ?? members[0];
    if (primary === undefined) continue;
    plans.push({
      key: primary.key,
      brandId: primary.brandId,
      productIds: members.map((m) => m.id).sort((a, b) => a - b),
      primaryProductId,
      displayName: modelDisplayName(primary),
    });
  }

  // A total, data-independent order so two runs (and two databases) agree.
  return plans.sort(
    (a, b) => a.key.localeCompare(b.key, "en") || (a.brandId ?? 0) - (b.brandId ?? 0),
  );
}

// ---------------------------------------------------------------- the admin job

type ExistingModel = {
  id: number;
  key: string;
  displayName: string;
  brandId: number | null;
  primaryProductId: number | null;
};

/**
 * DECISION: the spec defines `product_models.key` as the bare model key, and the column is UNIQUE - 
 * yet rules identify a group by (key, brandId) ("same key, brands 24 and 52 → two groups"). So the
 * bare key is stored, and only when another BRAND already holds it does the group fall back to
 * `<key>#<brandId>`. `planGroups` sorts by key then brandId, so on a fresh database the lower brand
 * id always wins the bare key and a re-run reproduces the same assignment.
 */
function storedKeyFor(
  plan: { key: string; brandId: number | null },
  owners: Map<string, ExistingModel>,
): string {
  const holder = owners.get(plan.key);
  if (holder === undefined || holder.brandId === plan.brandId) return plan.key;
  return `${plan.key}#${plan.brandId ?? 0}`;
}

const PRODUCT_ID = sql.raw("products.id");

/** products.repo rules - the ONE availability predicate, spelled the same way here. */
const availableSql = sql<boolean>`(
  ${products.stockPolicy} = 'untracked'
  or ${products.allowBackorder}
  or (${products.stockQty} - (
    select coalesce(sum(res.qty), 0)::int
    from inventory_reservations res
    where res.product_id = ${PRODUCT_ID}
      and res.released_at is null
      and res.consumed_at is null
  )) >= 1
)`;

// DECISION: "has an image" is the existence of a product_images row, not of a *usable* rendition - 
// the primary pick is a display tie-break, and a join to `media` (quarantine, renditions) would make
// the job scan the media table for a decision the card layer re-checks anyway.
const hasImageSql = sql<boolean>`exists (
  select 1 from product_images pim where pim.product_id = ${PRODUCT_ID}
)`;

export async function groupModels(
  db: Db,
  actor: Actor,
): Promise<{ groups: number; assigned: number }> {
  // rules: only status in {active, draft} participate; archived rows keep their old model_id.
  const rows = await db
    .select({
      id: products.id,
      brandId: products.brandId,
      name: products.name,
      displayName: products.displayName,
      sku: products.sku,
      modelCode: products.modelCode,
      modelId: products.modelId,
      price: products.price,
      available: availableSql,
      hasImage: hasImageSql,
    })
    .from(products)
    .where(inArray(products.status, ["active", "draft"]));

  const existing = await db
    .select({
      id: productModels.id,
      key: productModels.key,
      displayName: productModels.displayName,
      brandId: productModels.brandId,
      primaryProductId: productModels.primaryProductId,
    })
    .from(productModels);

  const manualModelIds = new Set(
    existing.filter((m) => m.key.startsWith(MANUAL_KEY_PREFIX)).map((m) => m.id),
  );
  const owners = new Map<string, ExistingModel>(existing.map((m) => [m.key, m]));

  // rules / EDGE CASE: a manual group is untouched - its members are not re-planned and never lose
  // their model_id.
  const candidates = rows.filter((r) => r.modelId === null || !manualModelIds.has(r.modelId));
  const plans = planGroups(
    candidates.map((r) => ({
      id: r.id,
      brandId: r.brandId,
      key: modelKey({
        name: r.name,
        displayName: r.displayName,
        sku: r.sku,
        modelCode: r.modelCode,
      }),
      available: r.available === true,
      priced: r.price > 0,
      hasImage: r.hasImage === true,
      displayName: r.displayName,
    })),
  );

  const assignedIds: number[] = [];

  await db.transaction(async (tx) => {
    const desired = new Map<number, number>();

    for (const plan of plans) {
      const key = storedKeyFor(plan, owners);
      const before = owners.get(key);
      let modelId: number;
      if (before === undefined) {
        const inserted = await tx
          .insert(productModels)
          .values({
            key,
            displayName: plan.displayName,
            brandId: plan.brandId,
            primaryProductId: plan.primaryProductId,
          })
          .returning({ id: productModels.id });
        const created = inserted[0];
        if (created === undefined) {
          throw appError("INTERNAL", {
            details: { reason: "insert_returned_nothing", entity: "product_model" },
          });
        }
        modelId = created.id;
        // A group inserted in THIS run owns the key for the groups still to come.
        owners.set(key, {
          id: modelId,
          key,
          displayName: plan.displayName,
          brandId: plan.brandId,
          primaryProductId: plan.primaryProductId,
        });
      } else {
        modelId = before.id;
        // rules: idempotent - an unchanged group writes nothing.
        const changed =
          before.displayName !== plan.displayName ||
          before.brandId !== plan.brandId ||
          before.primaryProductId !== plan.primaryProductId;
        if (changed) {
          await tx
            .update(productModels)
            .set({
              displayName: plan.displayName,
              brandId: plan.brandId,
              primaryProductId: plan.primaryProductId,
            })
            .where(eq(productModels.id, modelId));
        }
      }
      for (const productId of plan.productIds) desired.set(productId, modelId);
    }

    for (const row of candidates) {
      const next = desired.get(row.id) ?? null;
      if (row.modelId === next) continue;
      await tx.update(products).set({ modelId: next }).where(eq(products.id, row.id));
      assignedIds.push(row.id);
    }

    // DECISION: an auto row whose group disappeared is left in place rather than deleted. rules only
    // forbid deleting MANUAL rows, but a delete would silently detach every product another job or
    // admin already pointed at that model; an empty row costs one row and no query touches it.
    if (plans.length > 0 || assignedIds.length > 0) {
      // rules: one audit row per run. DECISION: the contract (and the spec) return only
      // { groups, assigned }, so the `product:<id>` tags rules mention have nowhere to go in the
      // signature - the changed ids travel in the audit payload instead, where a cache purge can
      // read them without widening a DECIDED return type.
      await audit.log(tx, actor, "catalog.models.group", "product_models", "*", undefined, {
        groups: plans.length,
        assigned: assignedIds.length,
        productIds: assignedIds,
      });
    }
  });

  return { groups: plans.length, assigned: assignedIds.length };
}

export async function setModel(
  db: Db,
  productId: number,
  modelId: number | null,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await tx
      .select({ id: products.id, modelId: products.modelId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const before = found[0];
    if (before === undefined) {
      throw appError("NOT_FOUND", { details: { entity: "product", id: productId } });
    }

    if (modelId !== null) {
      const model = await tx
        .select({ id: productModels.id })
        .from(productModels)
        .where(eq(productModels.id, modelId))
        .limit(1);
      if (model[0] === undefined) {
        throw appError("NOT_FOUND", { details: { entity: "product_model", id: modelId } });
      }
    }

    if (before.modelId === modelId) return;

    await tx.update(products).set({ modelId }).where(eq(products.id, productId));
    await audit.log(
      tx,
      actor,
      "product.model.set",
      "product",
      String(productId),
      { modelId: before.modelId },
      { modelId },
    );
  });
}
