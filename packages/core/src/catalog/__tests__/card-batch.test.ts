import { describe, expect, it } from "vitest";
import { products } from "@namilux/db";
import type { Db, SQL } from "@namilux/db";
import { findCardSources } from "../products.repo";

function row(id: number, patch: Partial<ReturnType<typeof baseRow>> = {}) {
  return { ...baseRow(id), ...patch };
}

function baseRow(id: number) {
  return {
    id, slug: `color-${id}`, name: `Color ${id}`, displayName: `Color ${id}`, modelId: 7,
    brandSlug: null, brandNameFa: null, brandNameEn: null, modelCode: "MODEL",
    colorName: `Color ${id}`, colorHex: null, swatchMediaId: null,
    status: "active" as "active" | "draft" | "archived",
    visibility: "public" as "public" | "hidden" | "link_only",
    price: 100_000, compareAtPrice: null, publishedAt: null, ratingAvg: "0", ratingCount: 0,
    stockPolicy: "untracked", stockQty: 0, allowBackorder: false, lowStockThreshold: 0, maxPerOrder: 20,
  };
}
type Row = ReturnType<typeof row>;

/** Evaluate the repository's actual product predicates against an in-memory fixture. No DB client. */
function memoryDb(rows: Row[]): Db {
  type Query = {
    from(value: unknown): Query; leftJoin(): Query; innerJoin(): Query; groupBy(): Query;
    where(value: SQL | undefined): Query;
    then(resolve: (value: Row[]) => unknown): Promise<unknown>;
  };
  return {
    select: () => {
      let table: unknown;
      let predicate: SQL | undefined;
      const query: Query = {
        from: (value) => { table = value; return query; },
        leftJoin: () => query,
        innerJoin: () => query,
        groupBy: () => query,
        where: (value) => { predicate = value; return query; },
        then: (resolve) => {
          if (table !== products || predicate === undefined) return Promise.resolve([]).then(resolve);
          const rendered = predicate.toQuery({
            casing: { getColumnCasing: (column: { name: string }) => column.name } as unknown as Parameters<SQL["toQuery"]>[0]["casing"],
            escapeName: (name) => `"${name}"`,
            escapeParam: (index) => `$${index + 1}`,
            escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
          });
          const values = (column: string, negative = false): unknown[] | null => {
            const match = new RegExp(`"${column}" ${negative ? "not " : ""}in \\(([^)]+)\\)`).exec(rendered.sql);
            return match?.[1] === undefined ? null : [...match[1].matchAll(/\$(\d+)/g)].map((m) => rendered.params[Number(m[1]) - 1]);
          };
          const ids = values("id");
          const excluded = values("id", true) ?? [];
          const models = values("model_id");
          const found = rows.filter((r) =>
            (ids === null || ids.includes(r.id)) && !excluded.includes(r.id) &&
            (models === null || models.includes(r.modelId)) &&
            (!rendered.sql.includes("= 'active'") || r.status === "active") &&
            (!rendered.sql.includes("= 'public'") || r.visibility === "public") &&
            (!rendered.params.includes("archived") || r.status !== "archived"),
          );
          return Promise.resolve(found).then(resolve);
        },
      };
      return query;
    },
  } as unknown as Db;
}

describe("product card variant batching", () => {
  it("each card has the same sibling set alone, together and in a reordered batch", async () => {
    const db = memoryDb([row(1), row(2), row(3)]);
    const [alone] = await findCardSources(db, [1]);
    const together = await findCardSources(db, [1, 2, 3]);
    const reordered = await findCardSources(db, [3, 1, 2, 1]);
    expect(alone?.siblings.map((s) => s.productId)).toEqual([2, 3]);
    expect(together.find((r) => r.id === 1)?.siblings).toEqual(alone?.siblings);
    expect(reordered.map((r) => r.id)).toEqual([3, 1, 2]);
    for (const card of together) {
      expect(card.siblings.map((s) => s.productId)).toEqual([1, 2, 3].filter((id) => id !== card.id));
    }
  });

  it("does not turn draft, hidden, link-only or archived batch members into visible swatches", async () => {
    const db = memoryDb([row(1), row(2), row(3, { status: "draft" }), row(4, { visibility: "hidden" }), row(5, { visibility: "link_only" }), row(6, { status: "archived" })]);
    const result = await findCardSources(db, [1, 2, 3, 4, 5, 6]);
    expect(result.find((r) => r.id === 1)?.siblings.map((s) => s.productId)).toEqual([2]);
    expect(result.find((r) => r.id === 2)?.siblings.map((s) => s.productId)).toEqual([1]);
    expect(result.some((r) => r.id === 6)).toBe(false);
  });
});
