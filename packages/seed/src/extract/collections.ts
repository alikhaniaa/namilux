import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { extractPath, productDirs } from "./paths.js";
import type { LegacyCurated } from "./products.js";
import { ensureUniqueSlug, slugifyEn } from "../transform/slugs.js";

export type CollectionSeed = {
  slug: string;
  name: string;
  kind: "group" | "sub" | "campaign";
  parentSlug: string | null;
  sort: number;
  isNav: boolean;
  productIds: number[];
  status: "active";
};

/** The ten human collections, DECIDED order (catalogue size desc as measured 14 Aug 2026). */
export const GROUPS: readonly { en: string; fa: string; slug: string; sort: number; isNav: boolean }[] = [
  { en: "Coffee & Drinks", fa: "قهوه و نوشیدنی", slug: "coffee-and-drinks", sort: 1, isNav: true },
  { en: "Kitchen & tableware", fa: "آشپزخانه و سرو", slug: "kitchen-and-tableware", sort: 2, isNav: true },
  { en: "Food prep", fa: "آماده‌سازی غذا", slug: "food-prep", sort: 3, isNav: true },
  { en: "Cooking", fa: "پخت و پز", slug: "cooking", sort: 4, isNav: true },
  { en: "Hair care", fa: "مراقبت مو", slug: "hair-care", sort: 5, isNav: true },
  { en: "Home cleaning", fa: "نظافت خانه", slug: "home-cleaning", sort: 6, isNav: true },
  { en: "Large appliances", fa: "لوازم بزرگ خانگی", slug: "large-appliances", sort: 7, isNav: false },
  { en: "Home textiles", fa: "منسوجات خانگی", slug: "home-textiles", sort: 8, isNav: false },
  { en: "Air quality", fa: "کیفیت هوا", slug: "air-quality", sort: 9, isNav: false },
  { en: "Wellness", fa: "سلامت", slug: "wellness", sort: 10, isNav: false },
];

export const CAMPAIGNS: Record<string, { slug: string; name: string }> = {
  "Dolce&Gabbana": { slug: "dolce-gabbana", name: "دولچه و گابانا" },
};

export const UNSORTED = { groupEn: "Unsorted", subEn: "Needs review" } as const;

export function collectionSlug(en: string): string {
  return slugifyEn(en);
}

function csvText(v: string | undefined): string {
  return (v ?? "").trim();
}

async function readCuratedRows(dir: string): Promise<Record<string, string | undefined>[]> {
  const buf = await readFile(extractPath(dir, "curatedCsv"));
  return parse(buf, { columns: true, bom: true, relax_column_count: true });
}

export async function curatedByProductId(dir: string): Promise<Map<number, LegacyCurated>> {
  const rows = await readCuratedRows(dir);
  const out = new Map<number, LegacyCurated>();
  for (const r of rows) {
    const id = Number(r["id"]);
    if (!Number.isFinite(id)) continue;
    out.set(id, {
      brandEn: csvText(r["brand_en"]),
      brandFa: csvText(r["brand_fa"]),
      groupEn: csvText(r["group_en"]),
      groupFa: csvText(r["group_fa"]),
      subEn: csvText(r["sub_en"]),
      subFa: csvText(r["sub_fa"]),
      collection: csvText(r["collection"]) || null,
      priceBand: csvText(r["price_band"]),
    });
  }
  return out;
}

export async function readCuratedCollections(
  dir: string,
): Promise<{ collections: CollectionSeed[]; unsorted: number[]; warnings: string[] }> {
  const rows = await readCuratedRows(dir);
  const warnings: string[] = [];
  const unsorted: number[] = [];
  const knownProductIds = new Set(productDirs(dir).map((p) => p.id));

  const groupBySlug = new Map(GROUPS.map((g) => [g.slug, g]));
  const groupByEn = new Map(GROUPS.map((g) => [g.en, g]));
  const groupMembers = new Map<string, number[]>(GROUPS.map((g) => [g.slug, []]));
  /** key = `${groupSlug}\x00${subEn}` so two groups may reuse a sub name. */
  const subs = new Map<string, { groupSlug: string; nameFa: string; en: string; productIds: number[] }>();
  const campaigns = new Map<string, { slug: string; name: string; productIds: number[] }>();

  for (const r of rows) {
    const id = Number(r["id"]);
    if (!Number.isFinite(id)) {
      warnings.push(`curated row without a numeric id skipped: ${JSON.stringify(r["name"] ?? "")}`);
      continue;
    }
    if (!knownProductIds.has(id)) {
      warnings.push(`curated id ${id} has no product folder — membership dropped`);
      continue;
    }
    const groupEn = csvText(r["group_en"]);
    const subEn = csvText(r["sub_en"]);
    const campaign = csvText(r["collection"]);

    if (campaign) {
      const meta = CAMPAIGNS[campaign];
      if (!meta) {
        warnings.push(`unknown curated collection "${campaign}" on product ${id} — no campaign row invented`);
      } else {
        const entry = campaigns.get(meta.slug) ?? { slug: meta.slug, name: meta.name, productIds: [] };
        entry.productIds.push(id);
        campaigns.set(meta.slug, entry);
      }
    }

    if (groupEn === UNSORTED.groupEn) {
      // The group wins: a stray sub label does not rescue an unsorted product.
      if (subEn && subEn !== UNSORTED.subEn) {
        warnings.push(`product ${id} is Unsorted but carries sub "${subEn}" — treated as unsorted`);
      }
      unsorted.push(id);
      continue;
    }

    const group = groupByEn.get(groupEn);
    if (!group) {
      warnings.push(`product ${id} has unknown curated group "${groupEn}" — treated as unsorted`);
      unsorted.push(id);
      continue;
    }
    (groupMembers.get(group.slug) as number[]).push(id);

    if (!subEn || subEn === UNSORTED.subEn) continue;
    const key = `${group.slug}\x00${subEn}`;
    const sub = subs.get(key) ?? { groupSlug: group.slug, nameFa: csvText(r["sub_fa"]) || subEn, en: subEn, productIds: [] };
    sub.productIds.push(id);
    subs.set(key, sub);
  }

  const taken = new Set<string>();
  const collections: CollectionSeed[] = [];

  for (const g of GROUPS) {
    taken.add(g.slug);
    collections.push({
      slug: g.slug,
      name: g.fa,
      kind: "group",
      parentSlug: null,
      sort: g.sort,
      isNav: g.isNav,
      // Groups own every member, including the ones that also sit in a sub.
      productIds: groupMembers.get(g.slug) ?? [],
      status: "active",
    });
  }

  for (const g of GROUPS) {
    const own = [...subs.values()]
      .filter((s) => s.groupSlug === g.slug)
      .sort((a, b) => b.productIds.length - a.productIds.length);
    own.forEach((s, index) => {
      const base = collectionSlug(s.en);
      const slug = ensureUniqueSlug(base, taken, g.slug);
      if (slug !== base) {
        warnings.push(`duplicate collection slug "${base}" — "${s.en}" in ${g.slug} became "${slug}"`);
      }
      collections.push({
        slug,
        name: s.nameFa,
        kind: "sub",
        parentSlug: g.slug,
        sort: index + 1,
        isNav: false,
        productIds: s.productIds,
        status: "active",
      });
    });
  }

  let campaignSort = 1;
  for (const c of campaigns.values()) {
    const slug = ensureUniqueSlug(c.slug, taken);
    if (slug !== c.slug) warnings.push(`campaign slug "${c.slug}" collided — became "${slug}"`);
    collections.push({
      slug,
      name: c.name,
      kind: "campaign",
      parentSlug: null,
      sort: campaignSort,
      isNav: false,
      productIds: c.productIds,
      status: "active",
    });
    campaignSort += 1;
  }

  if (groupBySlug.size !== GROUPS.length) warnings.push("GROUPS contains duplicate slugs");

  return { collections, unsorted, warnings };
}
