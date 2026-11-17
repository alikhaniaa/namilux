import { faNorm } from "@namilux/core/client";
import type { NavBrand, NavCollection, SearchIndexEntry } from "@namilux/core/client";
import { describe, expect, it } from "vitest";
import { highlight, normalizeWithMap, search } from "../search-engine";

function entry(over: Partial<SearchIndexEntry> & { id: number }): SearchIndexEntry {
  return {
    slug: `p-${String(over.id)}`,
    dn: "کالا",
    b: "",
    p: 1_000_000,
    s: true,
    c: [],
    ...over,
  };
}

const KETTLE = entry({ id: 1, dn: "کتری برقی اسمگ", b: "اسمگ", m: "KLF04BL", p: 41_500_000, s: true });
const TOASTER = entry({ id: 2, dn: "توستر اسمگ", b: "اسمگ", m: "TSF01", p: 32_000_000, s: true });
const HOOD = entry({ id: 3, dn: "هود مخفی کن", b: "کن", p: 0, s: false });

const brand = (over: Partial<NavBrand> & { slug: string }): NavBrand => ({
  name: "اسمگ",
  nameEn: "Smeg",
  count: 120,
  image: null,
  href: `/brand/${over.slug}/`,
  ...over,
});

const collection = (over: Partial<NavCollection> & { slug: string }): NavCollection => ({
  name: "کتری و چای‌ساز",
  count: 24,
  image: null,
  href: `/collection/${over.slug}/`,
  children: [],
  ...over,
});

describe("search engine", () => {
  it("Arabic yeh/kaf query matches Persian text", () => {
    // "كتري" carries the Arabic kaf and yeh; the index holds the Persian forms.
    const r = search([KETTLE, TOASTER, HOOD], "كتري");
    expect(r.products.map((p) => p.id)).toEqual([1]);
    expect(r.total).toBe(1);
  });

  it("model code KLF04 matches brand+model", () => {
    const r = search([KETTLE, TOASTER, HOOD], "KLF04");
    expect(r.products.map((p) => p.id)).toEqual([1]);
    // Persian digits inside a model code fold to ASCII, so "KLF۰۴" is the same query.
    expect(search([KETTLE, TOASTER, HOOD], "KLF۰۴").products.map((p) => p.id)).toEqual([1]);
  });

  it("fuzzy: کتری برغی finds کتری برقی", () => {
    const r = search([KETTLE, TOASTER, HOOD], "کتری برغی");
    expect(r.products.map((p) => p.id)).toEqual([1]);
  });

  it("in-stock priced items rank first on ties", () => {
    const out = entry({ id: 10, dn: "کتری برقی الف", p: 0, s: false });
    const cheapIn = entry({ id: 11, dn: "کتری برقی ب", p: 1_000_000, s: true });
    const dearIn = entry({ id: 12, dn: "کتری برقی ج", p: 9_000_000, s: true });
    const r = search([out, cheapIn, dearIn], "کتری برقی");
    // Same tier for all three: in-stock + priced first, then price desc among the equals.
    expect(r.products.map((p) => p.id)).toEqual([12, 11, 10]);
  });

  it("3,000-entry synthetic index searches under 80 ms", () => {
    const words = ["کتری", "توستر", "هود", "مایکروویو", "چای‌ساز", "همزن", "آبمیوه‌گیری"];
    const index: SearchIndexEntry[] = Array.from({ length: 3000 }, (_, i) =>
      entry({
        id: i + 1,
        dn: `${words[i % words.length] ?? "کالا"} برقی مدل ${String(i)}`,
        b: i % 2 === 0 ? "اسمگ" : "کن",
        m: `KLF${String(i).padStart(4, "0")}`,
        p: (i % 7) * 1_000_000,
        s: i % 3 !== 0,
      }),
    );
    // The first call also builds the normalization cache - the budget covers it.
    const first = search(index, "کتری برقی");
    const second = search(index, "توستر اسمگ");
    const third = search(index, "کتری برغی");
    expect(first.products.length).toBe(12);
    expect(first.ms).toBeLessThan(80);
    expect(second.ms).toBeLessThan(80);
    expect(third.ms).toBeLessThan(80);
  });

  it("groups brands and collections by name and leaves the index untouched", () => {
    const index = [KETTLE, TOASTER, HOOD];
    const snapshot = JSON.stringify(index);
    const r = search(index, "اسمگ", {
      brands: [brand({ slug: "smeg" }), brand({ slug: "kenwood", name: "کنوود", nameEn: "Kenwood", count: 40 })],
      collections: [collection({ slug: "kettles" }), collection({ slug: "toasters", name: "توستر", count: 9 })],
    });
    expect(r.brands.map((b) => b.slug)).toEqual(["smeg"]);
    expect(r.collections).toEqual([]);
    expect(r.products.map((p) => p.id)).toEqual([1, 2]);
    expect(JSON.stringify(index)).toBe(snapshot);
  });

  it("limits products to twelve by default and to all when asked", () => {
    const index = Array.from({ length: 20 }, (_, i) => entry({ id: i + 1, dn: "کتری برقی" }));
    expect(search(index, "کتری").products.length).toBe(12);
    expect(search(index, "کتری").total).toBe(20);
    expect(search(index, "کتری", { limit: Number.POSITIVE_INFINITY }).products.length).toBe(20);
    expect(search(index, "کتری", { limit: 3 }).products.length).toBe(3);
  });

  it("an empty or whitespace-only query matches nothing", () => {
    const r = search([KETTLE, TOASTER], "   ");
    expect(r).toMatchObject({ brands: [], collections: [], products: [], total: 0 });
  });

  it("a query nothing resembles returns no products", () => {
    expect(search([KETTLE, TOASTER, HOOD], "دوچرخه کوهستان").products).toEqual([]);
  });

  it("highlight cuts the runs out of the original text", () => {
    const runs = highlight("کتری برقی اسمگ", "برقی");
    expect(runs).toEqual([
      { text: "کتری ", hit: false },
      { text: "برقی", hit: true },
      { text: " اسمگ", hit: false },
    ]);
    expect(runs.map((r) => r.text).join("")).toBe("کتری برقی اسمگ");
  });

  it("highlight keeps ZWNJ and Arabic spellings in the returned text", () => {
    // The query is Arabic-spelled and the text carries a ZWNJ: the match is found on the normalized
    // twin, the runs are still the bytes the reader sees.
    const runs = highlight("چای‌ساز كنوود", "چای ساز");
    expect(runs.map((r) => r.text).join("")).toBe("چای‌ساز كنوود");
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["چای‌ساز"]);
  });

  it("highlight: no match and empty inputs", () => {
    expect(highlight("کتری برقی", "توستر")).toEqual([{ text: "کتری برقی", hit: false }]);
    expect(highlight("کتری برقی", "  ")).toEqual([{ text: "کتری برقی", hit: false }]);
    expect(highlight("", "کتری")).toEqual([]);
  });

  it("normalizeWithMap stays a twin of faNorm", () => {
    const samples = [
      "کتری برقی اسمگ",
      "چای‌ساز KLF۰۴  Smeg",
      "كتري برقي",
      "  مَدرسة  ",
      "هود مخفی‌کن",
      "",
    ];
    for (const s of samples) {
      const { norm, map } = normalizeWithMap(s);
      expect(norm).toBe(faNorm(s));
      expect(map.length).toBe(norm.length);
      for (const at of map) expect(at).toBeLessThan(s.length);
    }
  });
});
