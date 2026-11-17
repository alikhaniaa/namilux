import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  CAMPAIGNS,
  type CollectionSeed,
  GROUPS,
  UNSORTED,
  collectionSlug,
  curatedByProductId,
  readCuratedCollections,
} from "../collections.js";
import type { LegacyCurated } from "../products.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "curatedCsv"));

describe("collectionSlug (pure)", () => {
  it("sub slugs", () => {
    expect(collectionSlug("Stylers / Airwrap")).toBe("stylers-airwrap");
    expect(collectionSlug("Vacuums & steam")).toBe("vacuums-and-steam");
    expect(collectionSlug("Espresso machines")).toBe("espresso-machines");
    expect(collectionSlug("Mugs & bottles")).toBe("mugs-and-bottles");
  });

  it("the ten groups are declared in the DECIDED order with unique slugs", () => {
    expect(GROUPS).toHaveLength(10);
    expect(GROUPS.map((g) => g.slug)).toEqual([
      "coffee-and-drinks",
      "kitchen-and-tableware",
      "food-prep",
      "cooking",
      "hair-care",
      "home-cleaning",
      "large-appliances",
      "home-textiles",
      "air-quality",
      "wellness",
    ]);
    expect(GROUPS.map((g) => g.sort)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(GROUPS.filter((g) => g.isNav)).toHaveLength(6);
    for (const g of GROUPS) expect(collectionSlug(g.en)).toBe(g.slug);
  });
});

describe.skipIf(!hasExtract)("real curated CSV", () => {
  let collections: CollectionSeed[];
  let unsorted: number[];
  let warnings: string[];
  let curated: Map<number, LegacyCurated>;
  let bySlug: Map<string, CollectionSeed>;

  beforeAll(async () => {
    const res = await readCuratedCollections(dir);
    collections = res.collections;
    unsorted = res.unsorted;
    warnings = res.warnings;
    curated = await curatedByProductId(dir);
    bySlug = new Map(collections.map((c) => [c.slug, c]));
  });

  it("ten groups in decided order, 40 subs, one campaign", () => {
    const groups = collections.filter((c) => c.kind === "group");
    expect(groups.map((g) => g.slug)).toEqual(GROUPS.map((g) => g.slug));
    expect(collections.filter((c) => c.kind === "sub")).toHaveLength(40);
    expect(collections.filter((c) => c.kind === "campaign")).toHaveLength(1);
    expect(collections).toHaveLength(51);
    expect(new Set(collections.map((c) => c.slug)).size).toBe(51);
    expect(collections.every((c) => c.status === "active")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("unsorted excluded from every group and reported separately", () => {
    expect(unsorted).toHaveLength(26);
    const members = new Set(collections.filter((c) => c.kind !== "campaign").flatMap((c) => c.productIds));
    for (const id of unsorted) {
      expect(members.has(id)).toBe(false);
      expect(curated.get(id)?.groupEn).toBe(UNSORTED.groupEn);
      expect(curated.get(id)?.subEn).toBe(UNSORTED.subEn);
    }
  });

  it("group contains sub members and its own count", () => {
    const coffee = bySlug.get("coffee-and-drinks") as CollectionSeed;
    expect(coffee.productIds).toHaveLength(123);
    const subs = collections.filter((c) => c.parentSlug === "coffee-and-drinks");
    const groupMembers = new Set(coffee.productIds);
    for (const s of subs) for (const id of s.productIds) expect(groupMembers.has(id)).toBe(true);
    // Subs are ordered by member count desc within the group.
    const counts = subs.map((s) => s.productIds.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(subs.map((s) => s.sort)).toEqual(subs.map((_, i) => i + 1));
    expect(subs[0]?.slug).toBe("espresso-machines");
  });

  it("Wellness keeps its single product (ten groups is DECIDED)", () => {
    expect((bySlug.get("wellness") as CollectionSeed).productIds).toHaveLength(1);
  });

  it("campaign built from the collection column", () => {
    const campaign = collections.find((c) => c.kind === "campaign") as CollectionSeed;
    expect(campaign.slug).toBe(CAMPAIGNS["Dolce&Gabbana"]?.slug);
    expect(campaign.name).toBe(CAMPAIGNS["Dolce&Gabbana"]?.name);
    expect(campaign.productIds).toHaveLength(12);
    expect(campaign.parentSlug).toBeNull();
    // Campaign members keep their group/sub membership too.
    const groups = collections.filter((c) => c.kind === "group").flatMap((c) => c.productIds);
    expect(campaign.productIds.every((id) => groups.includes(id))).toBe(true);
  });

  it("duplicate sub slug disambiguated with the group prefix", async () => {
    // The 14 Aug data has no duplicate; assert the rule on the helper that implements it.
    const { ensureUniqueSlug } = await import("../../transform/slugs.js");
    const taken = new Set(["coffee-and-drinks", "juicers"]);
    expect(ensureUniqueSlug("juicers", taken, "cooking")).toBe("cooking-juicers");
    expect(new Set(collections.filter((c) => c.kind === "sub").map((c) => c.slug)).size).toBe(40);
  });

  it("curatedByProductId indexes all 541 rows for extract/products.ts", () => {
    expect(curated.size).toBe(541);
    const row = curated.get(62994) as LegacyCurated;
    expect(row).toMatchObject({ brandEn: "Dyson", brandFa: "دایسون", groupEn: "Hair care", subEn: "Stylers / Airwrap" });
    expect(row.collection).toBeNull();
    expect(row.priceBand).toBe("80M+");
    expect([...curated.values()].filter((r) => r.collection !== null)).toHaveLength(12);
  });

  it("seeded collections carry no rules and every membership points at a real product", async () => {
    const { productDirs } = await import("../paths.js");
    const ids = new Set(productDirs(dir).map((p) => p.id));
    for (const c of collections) {
      for (const id of c.productIds) expect(ids.has(id)).toBe(true);
      expect(c.isNav === true || c.isNav === false).toBe(true);
    }
  });
});
