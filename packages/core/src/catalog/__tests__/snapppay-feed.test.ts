import { describe, expect, it } from "vitest";
import type { ProductDetail } from "../../types";
import { SNAPPPAY_COLLECTOR_IPS, SNAPPPAY_FEED_MAX_SIZE, feedPaging, toSnapppayFeedItem } from "../snapppay-feed";

const detail = {
  id: 117,
  slug: "توستر-2-اسلایس-کوچک-اسمگ-smeg-مدل-tsf01",
  displayName: "توستر ۲ اسلایس کوچک اسمگ مدل TSF01 آبی پاستیلی",
  name: "Smeg TSF01 toaster",
  brand: { slug: "smeg", name: "اسمگ", nameEn: "Smeg" },
  modelCode: "TSF01",
  colorName: "آبی پاستیلی",
  price: 32_000_000,
  onRequest: false,
  available: true,
  lowStock: false,
  badges: [],
  variants: [],
  image: { key: "p/117/main.webp", alt: "", width: 1200, height: 1200 },
  gallery: [
    { key: "p/117/main.webp", alt: "", width: 1200, height: 1200 },
    { key: "p/117/side.webp", alt: "", width: 1200, height: 1200 },
  ],
  specs: [
    { name: "مشخصات", rows: [{ label: "توان", value: "950 وات" }, { label: "رنگ", value: "نادیده" }] },
    { name: null, rows: [{ label: "تعداد اسلایس", value: "2" }, { label: " ", value: "خالی" }] },
  ],
  warrantyMonths: 18,
  categories: [{ name: "توستر", href: "/category/کوچک/توستر/" }],
  publishedAt: null,
  salesRank: 0,
} as unknown as ProductDetail;

describe("snapppay feed", () => {
  it("maps a product to SnappPay's fields: Rial prices, absolute links, main image first, key→value description", () => {
    const item = toSnapppayFeedItem(detail, { origin: "https://namilux.ir/", categoryPath: "لوازم آشپزخانه > توستر" });
    expect(item).toMatchObject({
      id: "117",
      title: "توستر ۲ اسلایس کوچک اسمگ مدل TSF01 آبی پاستیلی",
      subtitle: "Smeg TSF01",
      availability: "in stock",
      regular_price: 320_000_000,
      sale_price: 320_000_000,
      category: "لوازم آشپزخانه > توستر",
      brand: "اسمگ",
      GTIN: null,
      color: "آبی پاستیلی",
    });
    expect(item.link).toMatch(/^https:\/\/namilux\.ir\/product\/.+\/$/u);
    expect(item.image_link).toEqual(["https://namilux.ir/media/p/117/main.webp", "https://namilux.ir/media/p/117/side.webp"]);
    // brand, model and colour first; a spec label already taken keeps its first value; empty labels drop
    expect(item.description).toEqual({ برند: "اسمگ", مدل: "TSF01", رنگ: "آبی پاستیلی", توان: "950 وات", "تعداد اسلایس": "2", گارانتی: "18 ماه" });
  });

  it("uses the published master rendition instead of an original upload key", () => {
    const p = { ...detail, image: { key: "raw/upload.bin", alt: "", width: 1200, height: 1200, renditions: { master: "official/product.jpg", webp: {}, avif: {} } }, gallery: [] };
    expect(toSnapppayFeedItem(p, { origin: "https://namilux.ir", categoryPath: "" }).image_link).toEqual(["https://namilux.ir/media/official/product.jpg"]);
  });

  it("an unavailable product is still listed, as out of stock", () => {
    expect(toSnapppayFeedItem({ ...detail, available: false }, { origin: "https://namilux.ir", categoryPath: "" }).availability).toBe("out of stock");
  });

  it("paging falls back instead of failing a crawler", () => {
    expect(feedPaging({})).toEqual({ page: 1, size: 100 });
    expect(feedPaging({ page: "3", size: "50" })).toEqual({ page: 3, size: 50 });
    expect(feedPaging({ page: "0", size: "100000" })).toEqual({ page: 1, size: SNAPPPAY_FEED_MAX_SIZE });
    expect(feedPaging({ page: "abc", size: "-5" })).toEqual({ page: 1, size: 100 });
  });

  it("names SnappPay's four collector addresses", () => {
    expect(SNAPPPAY_COLLECTOR_IPS).toEqual(["198.51.100.11", "198.51.100.12", "198.51.100.13", "198.51.100.14"]);
  });
});
