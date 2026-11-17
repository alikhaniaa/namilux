import type { Db } from "@namilux/db";
import type { CollectionCard, ProductCard } from "../types";
import type { Banner } from "../content/banners";
import { getSettings } from "../settings";
import { getBanners } from "../content/banners";
import { listRecentPosts } from "../content/posts";
import { discountPercent, toProductCard } from "./cards";
import { recommendedSort } from "./sort";
import { getBrandBySlug } from "./brands";
import { listCollections } from "./collections";
import { findCardSources, listReadyIds, listSaleIds } from "./products.repo";

export const HOME_READY_RAIL_SIZE = 8;
export const HOME_SALE_GRID_SIZE = 6;
export const HOME_JOURNAL_SIZE = 3;
export const HOME_CHAPTER_BRANDS = ["smeg", "dyson"] as const;

// DECISION (M0 step 3): BrandChapter / StoreInfo / HomeData are declared once in ../types
// (the spec §catalog · getHomeData).
// DECISION (M1): those three declarations now carry the module contract - see the DECISION block
// at their declaration site. Two names differ from the contract text and cannot: `BrandChapter.brand`
// is the canonical `BrandView` (a chapter renders the brand's claim, which `BrandSummary` does not
// carry - the spec items 4/6) and `collections` is `CollectionCard[]`, the ../types twin of
// `./collections.CollectionTile` (types/* must not import from ../catalog). No field of the contract
// is lost.
import type { BrandChapter, HomeData, StoreInfo } from "../types";

export type { BrandChapter, StoreInfo, HomeData };

/** The two settings keys that spell the store address; the chapter needs a one-line form of it. */
const ADDRESS_SHORT_PARTS = 2;

/**
 * rules: the store chapter shows a short address («تهران، میدان شوش») above the full one.
 * DECISION: settings carry ONE address (the spec `store.contact.address`), so the short form is its
 * first two segments rather than a new settings key an owner would have to keep in sync.
 */
function shortAddress(address: string): string {
  const parts = address
    .split(/[،,]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return "";
  return parts.slice(0, ADDRESS_SHORT_PARTS).join("، ");
}

async function storeInfo(db: Db): Promise<StoreInfo> {
  // getSettings memoizes for 30 s in-process (the spec §settings) - the home page never queries per visit.
  const settings = await getSettings(db);
  const info = settings["store.info"];
  const contact = settings["store.contact"];
  const hours = settings["store.hours"];
  const social = settings["store.social"];

  return {
    name: info.brandName,
    address: contact.address,
    addressShort: shortAddress(contact.address),
    // rules: `store.hours.note` is the human line («همه‌روزه ۱۰ تا ۲۱»); the per-day table is a
    // settings shape the About/Store page reads directly, not home copy.
    hours: hours.note,
    phoneMobile: contact.phoneMobile,
    phoneLand: contact.phoneLand,
    whatsapp: contact.whatsapp,
    mapsUrl: contact.mapUrl,
    instagram: social.instagram,
  };
}

/** rules: imaged buyable products first, imageless buyable ones only as filler; ties by recommended. */
function orderReadyRail(cards: ProductCard[]): ProductCard[] {
  const imaged = cards.filter((c) => c.image !== undefined).sort(recommendedSort);
  const imageless = cards.filter((c) => c.image === undefined).sort(recommendedSort);
  return [...imaged, ...imageless].slice(0, HOME_READY_RAIL_SIZE);
}

const cardDiscount = (c: ProductCard): number =>
  c.compareAt === undefined ? 0 : discountPercent(c.price, c.compareAt);

/** rules: available first, then discountPercent desc, then id desc (an unavailable row may fill). */
function orderSaleGrid(cards: ProductCard[]): ProductCard[] {
  return [...cards]
    .sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        cardDiscount(b) - cardDiscount(a) ||
        b.id - a.id,
    )
    .slice(0, HOME_SALE_GRID_SIZE);
}

async function cardsFor(db: Db, ids: number[], now: Date): Promise<ProductCard[]> {
  if (ids.length === 0) return [];
  const sources = await findCardSources(db, ids);
  return sources.map((source) => toProductCard(source, now));
}

function toCollectionCard(tile: {
  id: number;
  slug: string;
  name: string;
  kind: CollectionCard["kind"];
  cover: CollectionCard["cover"];
  coverDark: CollectionCard["coverDark"];
  productCount: number;
}): CollectionCard {
  return {
    id: tile.id,
    slug: tile.slug,
    name: tile.name,
    kind: tile.kind,
    cover: tile.cover,
    coverDark: tile.coverDark,
    count: tile.productCount,
  };
}

export async function getHomeData(db: Db, at?: Date): Promise<HomeData> {
  const now = at ?? new Date();

  const [heroBanners, promoBar, bands, readyIds, saleIds, tiles, journal, store] = await Promise.all(
    [
      getBanners(db, "home_hero", now),
      getBanners(db, "promo_bar", now),
      getBanners(db, "home_band", now),
      // Owner's presentation requirement: feature real, reviewed photography, not legacy blanks.
      // Prices/availability/discount ordering are unchanged; the complete catalog still lists all.
      listReadyIds(db, HOME_READY_RAIL_SIZE, { presentation: true }),
      listSaleIds(db, HOME_SALE_GRID_SIZE, { presentation: true }),
      // listCollections returns live collections only, ordered by sort then name - "the ten".
      listCollections(db, { kinds: ["group"], at: now }),
      listRecentPosts(db, HOME_JOURNAL_SIZE),
      storeInfo(db),
    ],
  );

  const [readyCards, saleCards] = await Promise.all([
    cardsFor(db, readyIds, now),
    cardsFor(db, saleIds, now),
  ]);

  const chapters: BrandChapter[] = [];
  for (const slug of HOME_CHAPTER_BRANDS) {
    // EDGE CASE: a missing or inactive brand is skipped - getBrandBySlug returns null for both.
    const brand = await getBrandBySlug(db, slug);
    if (brand === null) continue;
    // DECISION: only a band that NAMES this brand is used. `banners.pickForTarget` would also return
    // untargeted bands, which would put the same photograph in both the SMEG and the Dyson chapter;
    // rules say "targeted at the brand", and a missing band is an allowed state (claim-only chapter).
    const banner: Banner | null = bands.find((b) => b.targeting?.brandSlug === slug) ?? null;
    chapters.push({ brand, banner });
  }

  return {
    // EDGE CASE: getBanners orders by sort asc then id asc, so the first row IS "lower sort wins,
    // equal sort → lower id"; none live → null and the page renders its static hero.
    hero: heroBanners[0] ?? null,
    promoBar,
    readyRail: orderReadyRail(readyCards),
    chapters,
    collections: tiles.map(toCollectionCard),
    saleGrid: orderSaleGrid(saleCards),
    journal,
    store,
    generatedAt: now.toISOString(),
  };
}
