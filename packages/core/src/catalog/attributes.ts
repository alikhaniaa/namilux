import {
  type Db,
  asc,
  attributes as attributesTable,
  eq,
  inArray,
  productAttributeValues,
  productSpecs,
  products as productsTable,
} from "@namilux/db";
import type { Actor } from "../types";
import type { AttributeKind } from "./facets";
import type { ProductCard } from "./cards";
import { ATTRIBUTE_KINDS } from "../constants";
import { appError } from "../errors";
import type { AppError } from "../errors";
import { MINUS, faDigits, faInt, faZwnj, stripControl } from "../persian";
import { audit } from "../audit";
import { tags as cacheTags } from "../cache/tags";
import { attributeValueKey } from "./facets";
import { toProductCard } from "./cards";
import { findCardSources, replaceAttributeValues } from "./products.repo";

// DECISION (M0 step 3): AttributeDef is declared once in ../types.
import type { AttributeDef } from "../types";

export type { AttributeDef };

export type AttributeInput = {
  id?: number;
  key: string;
  label: string;
  unit: string | null;
  kind: AttributeKind;
  isFilterable: boolean;
  isComparable: boolean;
  sort: number;
};

export type AttributeValueInput = { key: string; valueText: string | null; valueNum: number | null };

export type ProductAttributeValue = AttributeDef & {
  valueText: string | null;
  valueNum: number | null;
  token: string;
};

export const COLOR_ATTRIBUTE_KEY = "color";
export const ATTRIBUTE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const COMPARE_MAX = 4;

export type CompareRow = {
  key: string;
  label: string;
  unit: string | null;
  kind: "attribute" | "spec";
  values: (string | null)[];
  allEqual: boolean;
};

export type CompareTable = { products: ProductCard[]; rows: CompareRow[] };

/** the spec - the Persian decimal separator U+066B (EDGE CASE: 1.5 L → "۱٫۵ L"). */
const DECIMAL_SEPARATOR = "٫";

/** rules / header contract: the two fixed boolean words of a spec table. */
const BOOL_TRUE_FA = "دارد";
const BOOL_FALSE_FA = "ندارد";

const LABEL_MAX = 80;
const UNIT_MAX = 20;
const VALUE_TEXT_MAX = 200;

/** Built, not thrown, so every call site reads `throw invalid(…)` and narrows the checked value. */
const invalid = (field: string, reason: string, extra?: Record<string, unknown>): AppError =>
  appError("VALIDATION", { details: { field, reason, ...extra } });

const isAttributeKind = (k: unknown): k is AttributeKind =>
  typeof k === "string" && (ATTRIBUTE_KINDS as readonly string[]).includes(k);

// ---------------------------------------------------------------- mapping

const attributeColumns = {
  id: attributesTable.id,
  key: attributesTable.key,
  label: attributesTable.label,
  unit: attributesTable.unit,
  kind: attributesTable.kind,
  isFilterable: attributesTable.isFilterable,
  isComparable: attributesTable.isComparable,
  sort: attributesTable.sort,
} as const;

type AttributeRowRaw = {
  id: number;
  key: string;
  label: string;
  unit: string | null;
  kind: AttributeKind;
  isFilterable: boolean;
  isComparable: boolean;
  sort: number;
};

function toDef(row: AttributeRowRaw): AttributeDef {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    unit: row.unit === null || row.unit.trim() === "" ? null : row.unit,
    kind: row.kind,
    isFilterable: row.isFilterable,
    isComparable: row.isComparable,
    sort: row.sort,
  };
}

/** `value_num` is a `numeric` column - postgres-js returns it as a string (or null). */
function toNum(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- read side

export async function listAttributes(
  db: Db,
  opts?: { filterableOnly?: boolean; comparableOnly?: boolean },
): Promise<AttributeDef[]> {
  const rows = await db
    .select(attributeColumns)
    .from(attributesTable)
    .orderBy(asc(attributesTable.sort), asc(attributesTable.label), asc(attributesTable.id));

  return rows
    .filter((r) => opts?.filterableOnly !== true || r.isFilterable)
    .filter((r) => opts?.comparableOnly !== true || r.isComparable)
    .map(toDef);
}

export async function valuesForProduct(db: Db, productId: number): Promise<ProductAttributeValue[]> {
  if (!Number.isInteger(productId)) return [];

  const rows = await db
    .select({
      ...attributeColumns,
      valueText: productAttributeValues.valueText,
      valueNum: productAttributeValues.valueNum,
    })
    .from(productAttributeValues)
    .innerJoin(attributesTable, eq(attributesTable.id, productAttributeValues.attributeId))
    .where(eq(productAttributeValues.productId, productId))
    .orderBy(asc(attributesTable.sort), asc(attributesTable.label), asc(attributesTable.id));

  return rows.map((row) => {
    const def = toDef(row);
    const valueNum = toNum(row.valueNum);
    return {
      ...def,
      valueText: row.valueText,
      valueNum,
      // rules: the token is the URL form - the same function the facet counts use, so a chip built
      // from a PDP value always matches the PLP facet option.
      token: attributeValueKey(def.kind, row.valueText, valueNum),
    };
  });
}

// ---------------------------------------------------------------- display

/**
 * DECISION: only `number` and text values take the unit. Appending it to a boolean would render
 * «دارد W»; the header pins the two boolean words and says nothing about a unit for them.
 */
export function formatAttributeValue(v: {
  kind: AttributeKind;
  valueText: string | null;
  valueNum: number | null;
  unit: string | null;
}): string {
  const unit = v.unit === null ? "" : v.unit.trim();
  const withUnit = (value: string): string =>
    value === "" || unit === "" ? value : `${value} ${unit}`;

  switch (v.kind) {
    case "bool":
      // Reuses the facets coercion so a legacy row that stored "yes" in value_text reads «دارد».
      if (v.valueNum === null && (v.valueText === null || v.valueText.trim() === "")) return "";
      return attributeValueKey("bool", v.valueText, v.valueNum) === "1" ? BOOL_TRUE_FA : BOOL_FALSE_FA;

    case "number": {
      const n = v.valueNum;
      if (n === null || !Number.isFinite(n)) return "";
      if (Number.isInteger(n)) return withUnit(faInt(n));
      // EDGE CASE: 1.5 with unit "L" → "۱٫۵ L" - the fraction keeps Persian digits, the unit is Latin.
      const [intPart = "0", fraction = ""] = Math.abs(n).toString().split(".");
      const sign = n < 0 ? MINUS : "";
      const whole = faInt(Number(intPart));
      const rendered = fraction === "" ? whole : `${whole}${DECIMAL_SEPARATOR}${faDigits(fraction)}`;
      return withUnit(`${sign}${rendered}`);
    }

    case "text":
    case "color": {
      const text = v.valueText === null ? "" : v.valueText.trim();
      if (text === "") return "";
      // the spec: Latin digits survive only inside a Latin designator - that is `guard = true`.
      return withUnit(faDigits(text, true));
    }
  }
}

// ---------------------------------------------------------------- write side

function normalizeAttributeInput(input: AttributeInput): {
  key: string;
  values: {
    key: string;
    label: string;
    unit: string | null;
    kind: AttributeKind;
    isFilterable: boolean;
    isComparable: boolean;
    sort: number;
  };
} {
  const key = typeof input.key === "string" ? input.key.trim() : "";
  // EDGE CASE: "Color" / "رنگ" → VALIDATION. The key is a URL token, so it is never lower-cased for
  // the caller: a wrong case is a mistake to report, not to silently rewrite.
  if (!ATTRIBUTE_KEY_RE.test(key)) throw invalid("key", "key_shape", { key });
  if (!isAttributeKind(input.kind)) throw invalid("kind", "unknown_kind", { key });

  const label = faZwnj(stripControl(typeof input.label === "string" ? input.label : "").trim());
  if (label === "") throw invalid("label", "required", { key });
  if (label.length > LABEL_MAX) throw invalid("label", "too_long", { key });

  const rawUnit = stripControl(typeof input.unit === "string" ? input.unit : "").trim();
  if (rawUnit.length > UNIT_MAX) throw invalid("unit", "too_long", { key });

  const sort = Number.isFinite(input.sort) ? Math.trunc(input.sort) : 0;

  return {
    key,
    values: {
      key,
      label,
      unit: rawUnit === "" ? null : rawUnit,
      kind: input.kind,
      isFilterable: input.isFilterable === true,
      isComparable: input.isComparable === true,
      sort,
    },
  };
}

export async function upsertAttribute(
  db: Db,
  input: AttributeInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const { key, values } = normalizeAttributeInput(input);

  const id = await db.transaction(async (tx) => {
    const clash = (
      await tx
        .select({ id: attributesTable.id })
        .from(attributesTable)
        .where(eq(attributesTable.key, key))
        .limit(1)
    )[0];

    if (input.id === undefined) {
      if (clash !== undefined) {
        throw appError("CONFLICT", { details: { field: "key", reason: "key_taken", key } });
      }
      const inserted = await tx
        .insert(attributesTable)
        .values(values)
        .returning({ id: attributesTable.id });
      const created = inserted[0];
      if (created === undefined) {
        throw appError("INTERNAL", {
          details: { reason: "insert_returned_nothing", entity: "attribute" },
        });
      }
      await audit.log(tx, actor, "attribute.create", "attribute", String(created.id), undefined, values);
      return created.id;
    }

    const before = (
      await tx
        .select(attributeColumns)
        .from(attributesTable)
        .where(eq(attributesTable.id, input.id))
        .limit(1)
    )[0];
    if (before === undefined) {
      throw appError("NOT_FOUND", { details: { entity: "attribute", id: input.id } });
    }

    // rules: the key is a URL token - it never changes.
    if (before.key !== key) {
      throw appError("CONFLICT", {
        details: { field: "key", reason: "key_immutable", key: before.key },
      });
    }

    if (before.kind !== values.kind) {
      const used = (
        await tx
          .select({ productId: productAttributeValues.productId })
          .from(productAttributeValues)
          .where(eq(productAttributeValues.attributeId, before.id))
          .limit(1)
      )[0];
      // EDGE CASE: kind change after values exist → VALIDATION (the stored values would lie).
      if (used !== undefined) throw invalid("kind", "kind_immutable_with_values", { key });
    }

    await tx.update(attributesTable).set(values).where(eq(attributesTable.id, before.id));
    await audit.log(tx, actor, "attribute.update", "attribute", String(before.id), before, values);
    return before.id;
  });

  // DECISION: tags are built from ../cache/tags (as ./brands.ts does) rather than
  // ../cache/invalidation.tagsForAttributeChange - that module was not yet built when this was written and throws.
  // An attribute is a facet of every scope, so the whole catalogue is the blast radius.
  return { id, tags: [cacheTags.catalog] };
}

/** rules: kind decides which of the two value columns may be filled. */
function valueColumnsFor(
  def: AttributeDef,
  value: AttributeValueInput,
): { valueText: string | null; valueNum: number | null } {
  const key = def.key;
  const text = typeof value.valueText === "string" ? stripControl(value.valueText).trim() : null;
  const num = value.valueNum;

  switch (def.kind) {
    case "text":
    case "color": {
      if (text === null || text === "") throw invalid("valueText", "required", { key });
      if (text.length > VALUE_TEXT_MAX) throw invalid("valueText", "too_long", { key });
      if (num !== null && num !== undefined) throw invalid("valueNum", "not_allowed", { key });
      // rules / the spec: text values are ZWNJ-corrected at write.
      return { valueText: faZwnj(text), valueNum: null };
    }
    case "number": {
      // EDGE CASE: a number attribute carrying valueText "1.5" → VALIDATION.
      if (text !== null && text !== "") throw invalid("valueText", "not_allowed", { key });
      if (typeof num !== "number" || !Number.isFinite(num)) {
        throw invalid("valueNum", "required", { key });
      }
      return { valueText: null, valueNum: num };
    }
    case "bool": {
      if (text !== null && text !== "") throw invalid("valueText", "not_allowed", { key });
      if (num !== 0 && num !== 1) throw invalid("valueNum", "expected_0_or_1", { key });
      return { valueText: null, valueNum: num };
    }
  }
}

export async function setProductAttributeValues(
  db: Db,
  productId: number,
  values: AttributeValueInput[],
  actor: Actor,
): Promise<void> {
  if (!Number.isInteger(productId)) throw invalid("productId", "invalid");
  const input = Array.isArray(values) ? values : [];

  const keys = input.map((v) => (typeof v.key === "string" ? v.key.trim() : ""));
  const seen = new Set<string>();
  for (const key of keys) {
    if (key === "") throw invalid("key", "required");
    // DECISION: a repeated key is rejected, not last-wins - (product_id, attribute_id) is the primary
    // key, so a duplicate is a caller bug and silently dropping one of the two values hides it.
    if (seen.has(key)) throw invalid("key", "duplicate", { key });
    seen.add(key);
  }

  await db.transaction(async (tx) => {
    const product = (
      await tx
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1)
    )[0];
    if (product === undefined) {
      throw appError("NOT_FOUND", { details: { entity: "product", id: productId } });
    }

    const defs =
      keys.length === 0
        ? []
        : (
            await tx
              .select(attributeColumns)
              .from(attributesTable)
              .where(inArray(attributesTable.key, keys))
          ).map(toDef);
    const byKey = new Map(defs.map((d) => [d.key, d]));

    const rows: { attributeId: number; valueText: string | null; valueNum: number | null }[] = [];
    for (const [index, value] of input.entries()) {
      const key = keys[index] ?? "";
      const def = byKey.get(key);
      if (def === undefined) throw invalid("key", "unknown_attribute", { key });
      rows.push({ attributeId: def.id, ...valueColumnsFor(def, value) });
    }

    const before = (
      await tx
        .select({
          attributeId: productAttributeValues.attributeId,
          valueText: productAttributeValues.valueText,
          valueNum: productAttributeValues.valueNum,
        })
        .from(productAttributeValues)
        .where(eq(productAttributeValues.productId, productId))
    ).map((r) => ({ ...r, valueNum: toNum(r.valueNum) }));

    // rules: replace-all, in the caller transaction, through the repository that owns the table.
    await replaceAttributeValues(tx, productId, rows);
    await audit.log(
      tx,
      actor,
      "product.attributes.update",
      "product",
      String(productId),
      { values: before },
      { values: rows },
    );
  });
}

// ---------------------------------------------------------------- compare

function rowFor(
  key: string,
  label: string,
  unit: string | null,
  kind: "attribute" | "spec",
  values: (string | null)[],
): CompareRow | null {
  // rules: a row where every product is missing the value is omitted.
  if (values.every((v) => v === null)) return null;
  const first = values[0];
  const allEqual = values.every((v) => v !== null && v === first);
  return { key, label, unit, kind, values, allEqual };
}

export async function compareRows(db: Db, ids: number[]): Promise<CompareTable> {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => Number.isInteger(id)))]
    // EDGE CASE: 5 ids → the first 4 are used, no throw.
    .slice(0, COMPARE_MAX);
  if (wanted.length === 0) return { products: [], rows: [] };

  // DECISION: the cards are hydrated with products.repo.findCardSources + cards.toProductCard rather
  // than products.service.getProductCards (this module dependency list) - that function is the same two
  // calls and was not yet built when this was written, and importing the service from here would close a module cycle
  // (products.service composes the attribute rows of a PDP).
  const sources = await findCardSources(db, wanted);
  // "unknown/inactive ids dropped": findCardSources already drops archived rows; a draft or hidden
  // product is not a shopper-visible row either. `link_only` stays - the shopper reached it by link.
  const usable = sources.filter((s) => s.status === "active" && s.visibility !== "hidden");
  const cards = usable.map((s) => toProductCard(s));
  const productIds = cards.map((c) => c.id);
  if (productIds.length === 0) return { products: [], rows: [] };

  const [defs, valueRows, specRows] = await Promise.all([
    listAttributes(db, { comparableOnly: true }),
    db
      .select({
        productId: productAttributeValues.productId,
        attributeId: productAttributeValues.attributeId,
        valueText: productAttributeValues.valueText,
        valueNum: productAttributeValues.valueNum,
      })
      .from(productAttributeValues)
      .where(inArray(productAttributeValues.productId, productIds)),
    db
      .select({
        productId: productSpecs.productId,
        label: productSpecs.label,
        value: productSpecs.value,
        sort: productSpecs.sort,
      })
      .from(productSpecs)
      .where(inArray(productSpecs.productId, productIds))
      .orderBy(asc(productSpecs.sort), asc(productSpecs.id)),
  ]);

  const rows: CompareRow[] = [];

  // 1. comparable attributes, in attributes.sort order.
  const valueOf = new Map<string, { valueText: string | null; valueNum: number | null }>();
  for (const v of valueRows) {
    valueOf.set(`${v.productId}:${v.attributeId}`, {
      valueText: v.valueText,
      valueNum: toNum(v.valueNum),
    });
  }
  for (const def of defs) {
    const values = productIds.map((productId) => {
      const found = valueOf.get(`${productId}:${def.id}`);
      if (found === undefined) return null;
      const rendered = formatAttributeValue({
        kind: def.kind,
        valueText: found.valueText,
        valueNum: found.valueNum,
        unit: def.unit,
      });
      return rendered === "" ? null : rendered;
    });
    const row = rowFor(def.key, def.label, def.unit, "attribute", values);
    if (row !== null) rows.push(row);
  }

  // 2. the UNION of product_specs labels, in first-seen order across the products in `ids` order.
  const specsByProduct = new Map<number, Map<string, string>>();
  const labelOrder: string[] = [];
  const labelSeen = new Set<string>();
  for (const productId of productIds) {
    const bucket = new Map<string, string>();
    for (const spec of specRows) {
      if (spec.productId !== productId) continue;
      const label = spec.label.trim();
      const value = spec.value.trim();
      if (label === "" || value === "") continue;
      // A product that repeats a label keeps its first (lowest sort) row.
      if (!bucket.has(label)) bucket.set(label, value);
      if (!labelSeen.has(label)) {
        labelSeen.add(label);
        labelOrder.push(label);
      }
    }
    specsByProduct.set(productId, bucket);
  }
  for (const label of labelOrder) {
    const values = productIds.map(
      (productId) => specsByProduct.get(productId)?.get(label) ?? null,
    );
    // DECISION: a spec row key is prefixed so it can never collide with an attribute key (both end
    // up as React keys / anchor ids in one table); specs have no unit column of their own.
    const row = rowFor(`spec:${label}`, label, null, "spec", values);
    if (row !== null) rows.push(row);
  }

  return { products: cards, rows };
}
