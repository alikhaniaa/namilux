import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { brands as brandsTable, products as productsTable, sql } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import { LEGACY_BRAND_IDS, NEW_BRAND_SLUGS, getBrandBySlug, isLatinSlug, listBrands, upsertBrand } from "../brands";
import type { BrandInput, BrandSummary } from "../brands";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "staff-test" };

async function expectAppError(promise: Promise<unknown>, code: ErrorCode, reason?: string): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(isAppError(err)).toBe(true);
    if (!isAppError(err)) return;
    expect(err.code).toBe(code);
    if (reason !== undefined) expect(err.details).toMatchObject({ reason });
    return;
  }
  throw new Error(`expected an AppError ${code}`);
}

// ── pure ───────────────────────────────────────────────────────────────────────────────────────

describe("latin slug validation", () => {
  const cases: [slug: string, expected: boolean][] = [
    ["smeg", true],
    ["berghoff", true],
    ["kitchen-aid", true],
    ["a1", true],
    ["a", false],
    ["", false],
    ["SMEG", false],
    ["اسمگ", false],
    ["two words", false],
    ["under_score", false],
    ["dot.com", false],
    ["slash/es", false],
    ["x".repeat(41), false],
  ];

  it.each(cases)("isLatinSlug(%j) → %s", (slug, expected) => {
    expect(isLatinSlug(slug)).toBe(expected);
  });

  it("every legacy id and new slug of the spec is a valid latin slug", () => {
    expect(Object.keys(LEGACY_BRAND_IDS)).toHaveLength(7);
    expect(LEGACY_BRAND_IDS["smeg"]).toBe(24);
    expect(NEW_BRAND_SLUGS).toHaveLength(6);
    for (const slug of [...Object.keys(LEGACY_BRAND_IDS), ...NEW_BRAND_SLUGS]) {
      expect(isLatinSlug(slug)).toBe(true);
    }
  });
});

// ── database ───────────────────────────────────────────────────────────────────────────────────

/** One of the 7 legacy brand ids → its slug is frozen. */
const LEGACY_ID = LEGACY_BRAND_IDS["smeg"] ?? 24;
const BASE = 820_000;
const NEW_BRAND_ID = BASE + 1;
const INACTIVE_ID = BASE + 2;
const EMPTY_ID = BASE + 3;

const PREFIX = "brandt";
const LEGACY_SLUG = `${PREFIX}-smeg`;
const NEW_SLUG = `${PREFIX}-ninja`;
const INACTIVE_SLUG = `${PREFIX}-gone`;
const EMPTY_SLUG = `${PREFIX}-breville`;
const FIXTURE_IDS = [LEGACY_ID, NEW_BRAND_ID, INACTIVE_ID, EMPTY_ID];

const inputDefaults = {
  claim: "",
  storyHtml: "",
  logoMediaId: null,
  seoTitle: null,
  seoDescription: null,
  robots: "index, follow",
  isActive: true,
  sort: 0,
};

/** Only the fixture brands - the test database is shared with the other suites. */
const mine = (rows: BrandSummary[]): BrandSummary[] => rows.filter((b) => FIXTURE_IDS.includes(b.id));

describe.skipIf(!hasTestDb())("brands against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  async function seed(tx: Db): Promise<void> {
    await tx.insert(brandsTable).values([
      { id: LEGACY_ID, slug: LEGACY_SLUG, nameFa: "اسمگ", nameEn: "Smeg", sort: 1, isActive: true },
      { id: NEW_BRAND_ID, slug: NEW_SLUG, nameFa: "نینجا", nameEn: "Ninja", sort: 1, isActive: true },
      { id: INACTIVE_ID, slug: INACTIVE_SLUG, nameFa: "رفته", nameEn: "Gone", sort: 0, isActive: false },
      { id: EMPTY_ID, slug: EMPTY_SLUG, nameFa: "برویل", nameEn: "Breville", sort: 2, isActive: true },
    ]);
    await tx.insert(productsTable).values([
      // legacy brand: one buyable, one out of stock, one on-request, one draft (never counted)
      { id: BASE + 11, slug: `${PREFIX}-s1`, name: "s1", displayName: "s1", brandId: LEGACY_ID, status: "active", visibility: "public", price: 41_500_000, stockQty: 3 },
      { id: BASE + 12, slug: `${PREFIX}-s2`, name: "s2", displayName: "s2", brandId: LEGACY_ID, status: "active", visibility: "public", price: 20_000_000, stockQty: 0 },
      { id: BASE + 13, slug: `${PREFIX}-s3`, name: "s3", displayName: "s3", brandId: LEGACY_ID, status: "active", visibility: "public", price: 0, stockQty: 5 },
      { id: BASE + 14, slug: `${PREFIX}-s4`, name: "s4", displayName: "s4", brandId: LEGACY_ID, status: "draft", visibility: "public", price: 9, stockQty: 9 },
      // the new brand: everything out of stock → coming soon
      { id: BASE + 15, slug: `${PREFIX}-n1`, name: "n1", displayName: "n1", brandId: NEW_BRAND_ID, status: "active", visibility: "public", price: 5_000_000, stockQty: 0 },
      { id: BASE + 16, slug: `${PREFIX}-n2`, name: "n2", displayName: "n2", brandId: NEW_BRAND_ID, status: "active", visibility: "public", price: 6_000_000, stockQty: 0 },
    ]);
    // Explicit ids leave the serial sequence behind; push it past them so a row created by
    // `upsertBrand` with a default id cannot collide (the seed's `syncSequence` does the same).
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('brands', 'id'), (select coalesce(max(id), 1) from brands), true)`,
    );
  }

  it("case-insensitive slug", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      for (const variant of [LEGACY_SLUG, LEGACY_SLUG.toUpperCase(), ` ${LEGACY_SLUG} `, "BrandT-SmEg"]) {
        const view = await getBrandBySlug(tx, variant);
        expect(view?.id).toBe(LEGACY_ID);
        // the canonical is always the lowercase form
        expect(view?.seo.canonical).toBe(`/brand/${LEGACY_SLUG}/`);
      }
      expect(await getBrandBySlug(tx, "")).toBeNull();
      expect(await getBrandBySlug(tx, `${PREFIX}-nope`)).toBeNull();
    });
  });

  it("inactive returns null", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      expect(await getBrandBySlug(tx, INACTIVE_SLUG)).toBeNull();
      // …and it is filtered out of the summaries when the caller asks for active ones only
      expect(mine(await listBrands(tx, { activeOnly: true })).map((b) => b.slug)).not.toContain(INACTIVE_SLUG);
      expect(mine(await listBrands(tx)).map((b) => b.slug)).toContain(INACTIVE_SLUG);
    });
  });

  it("comingSoon when zero buyable", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const ninja = await getBrandBySlug(tx, NEW_SLUG);
      expect(ninja?.productCount).toBe(2);
      expect(ninja?.buyableCount).toBe(0);
      // rules: comingSoon = isActive && buyableCount === 0 (derived by the page from the view)
      expect(ninja !== null && ninja.isActive && ninja.buyableCount === 0).toBe(true);

      // the legacy brand: 3 active+public rows, only one buyable (in stock AND price > 0)
      const smeg = await getBrandBySlug(tx, LEGACY_SLUG);
      expect(smeg?.productCount).toBe(3);
      expect(smeg?.buyableCount).toBe(1);
      expect(smeg !== null && smeg.buyableCount === 0).toBe(false);
      expect(smeg?.seo.title).toBe("اسمگ - نامی لوکس");
      expect(smeg?.claim).toBeNull();
    });
  });

  it("empty brand still served", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const breville = await getBrandBySlug(tx, EMPTY_SLUG);
      expect(breville).not.toBeNull();
      expect(breville?.productCount).toBe(0);
      expect(breville?.buyableCount).toBe(0);
      expect(breville?.logo).toBeNull();
      expect(breville?.storyHtml).toBe("");
      expect(breville?.seo.ogImage).toBeNull();
    });
  });

  it("listBrands ordering", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      // sort asc → productCount desc → nameEn asc
      expect(mine(await listBrands(tx)).map((b) => b.slug)).toEqual([
        INACTIVE_SLUG,
        LEGACY_SLUG,
        NEW_SLUG,
        EMPTY_SLUG,
      ]);
      const smeg = mine(await listBrands(tx)).find((b) => b.slug === LEGACY_SLUG);
      expect(smeg).toMatchObject({ name: "اسمگ", nameEn: "Smeg", productCount: 3, buyableCount: 1, sort: 1 });
    });
  });

  it("legacy slug immutable", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const base: BrandInput = { ...inputDefaults, id: LEGACY_ID, slug: LEGACY_SLUG, nameFa: "اسمگ", nameEn: "Smeg" };
      await expect(
        upsertBrand(tx, { ...base, claim: "زیبایی، به شکل یک وسیلهٔ خانگی." }, ACTOR),
      ).resolves.toMatchObject({
        id: LEGACY_ID,
        tags: [`brand:${LEGACY_ID}`, "nav", "catalog", "home", "sitemap"],
      });
      await expectAppError(
        upsertBrand(tx, { ...base, slug: `${LEGACY_SLUG}-new` }, ACTOR),
        "CONFLICT",
        "legacy_slug_immutable",
      );
      // a NEW brand may be renamed - and the old URL keeps working through a 301
      await expect(
        upsertBrand(
          tx,
          { ...inputDefaults, id: NEW_BRAND_ID, slug: `${PREFIX}-ninja-kitchen`, nameFa: "نینجا", nameEn: "Ninja" },
          ACTOR,
        ),
      ).resolves.toMatchObject({ id: NEW_BRAND_ID });
      expect(await getBrandBySlug(tx, NEW_SLUG)).toBeNull();
      expect((await getBrandBySlug(tx, `${PREFIX}-ninja-kitchen`))?.id).toBe(NEW_BRAND_ID);
    });
  });

  it("upsert validates the slug and refuses a taken one", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      await expectAppError(
        upsertBrand(tx, { ...inputDefaults, slug: "اسمگ", nameFa: "اسمگ", nameEn: "Smeg" }, ACTOR),
        "VALIDATION",
        "not_latin_slug",
      );
      await expectAppError(
        upsertBrand(tx, { ...inputDefaults, slug: "two words", nameFa: "اسمگ", nameEn: "Smeg" }, ACTOR),
        "VALIDATION",
        "not_latin_slug",
      );
      await expectAppError(
        upsertBrand(tx, { ...inputDefaults, slug: LEGACY_SLUG, nameFa: "دیگری", nameEn: "Other" }, ACTOR),
        "CONFLICT",
        "slug_taken",
      );
      await expectAppError(
        upsertBrand(tx, { ...inputDefaults, slug: `${PREFIX}-tefal`, nameFa: "  ", nameEn: "Tefal" }, ACTOR),
        "VALIDATION",
        "required",
      );
      const created = await upsertBrand(
        tx,
        {
          ...inputDefaults,
          slug: `${PREFIX}-tefal`,
          nameFa: "تفال",
          nameEn: "Tefal",
          storyHtml: "<p>سلام</p><script>x()</script>",
        },
        ACTOR,
      );
      const view = await getBrandBySlug(tx, `${PREFIX}-tefal`);
      expect(view?.id).toBe(created.id);
      // the spec - the script tag never reaches the database
      expect(view?.storyHtml).not.toContain("script");
    });
  });
});
