import { faInt } from "../persian/format";
import type { Metadata, MetaInput } from "../types";
import { absUrl, decPath, encPath } from "../url";
import { PLP_DEFAULTS, plpUrl } from "../url/plp-state";
import type { PlpState } from "../url/plp-state";

/** the spec · a filtered listing is followable but not indexable. */
export const NOINDEX_FOLLOW = "noindex, follow";

/**
 * DECISION: the same predicate `catalog/list.isFiltered` applies, restated here from
 * `PLP_DEFAULTS` rather than imported · `seo/*` must not depend on `catalog/*` (that direction is
 * already taken by jsonld's consumers, and metadata has to stay importable from a route that never
 * touches the catalogue). `page` and `density` are deliberately not filters: `?page=N` is
 * indexable with a self-canonical, and density is a viewing preference.
 */
function isFilteredState(state: PlpState): boolean {
  if (state.brand?.length) return true;
  if (state.collection?.length) return true;
  if (state.color?.length) return true;
  if (state.avail?.length) return true;
  if (state.priceMin !== undefined || state.priceMax !== undefined) return true;
  if (state.attr !== undefined && Object.keys(state.attr).length > 0) return true;
  return (state.sort ?? PLP_DEFAULTS.sort) !== PLP_DEFAULTS.sort;
}
const DEFAULT_ROBOTS = "index, follow";

export type MetadataCtx = {
  origin?: string;
  siteName?: string;
  defaultOgKey: string;
  mediaUrl: (key: string) => string;
};

export function buildMetadata(i: MetaInput, ctx: MetadataCtx): Metadata {
  const origin = i.origin === "" ? (ctx.origin ?? "") : i.origin;
  const siteName = i.siteName === "" ? (ctx.siteName ?? "") : i.siteName;

  // decPath first so an already-encoded path is not encoded twice; encPath then guarantees the
  // lowercase-hex, trailing-slash form the 752-URL contract is written in. A query
  // string (only ever `?page=N` here · a filtered URL canonicalises to the base) is split off
  // first: it is ASCII and must survive verbatim, not come back as %3fpage%3d2.
  const q = i.path.indexOf("?");
  const pathOnly = q === -1 ? i.path : i.path.slice(0, q);
  const query = q === -1 ? "" : i.path.slice(q);
  const canonical = absUrl(origin, encPath(decPath(pathOnly))) + query;

  const title = i.title === null || i.title === "" ? siteName : i.title;
  // the spec + §7.1: 86 legacy pages have no description. It stays missing until a human writes
  // one · an auto-generated description is a new signal, and parity comes first.
  const description = i.description === null || i.description === "" ? undefined : i.description;

  const ogKey = i.ogImage === null || i.ogImage === "" ? ctx.defaultOgKey : i.ogImage;
  const ogUrl = ogKey === "" ? null : ctx.mediaUrl(ogKey);

  return {
    title,
    ...(description === undefined ? {} : { description }),
    alternates: { canonical },
    robots: i.robots === "" ? DEFAULT_ROBOTS : i.robots,
    openGraph: {
      title,
      ...(description === undefined ? {} : { description }),
      type: i.ogType,
      url: canonical,
      siteName,
      locale: "fa_IR",
      // Every indexable page carries an image: the entity's card, else the site default.
      images: ogUrl === null ? [] : [{ url: ogUrl }],
      ...(i.publishedAt === undefined ? {} : { publishedTime: i.publishedAt }),
      ...(i.modifiedAt === undefined ? {} : { modifiedTime: i.modifiedAt }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      ...(description === undefined ? {} : { description }),
      images: ogUrl === null ? [] : [ogUrl],
    },
  };
}

export function titleFor(entity: { seoTitle?: string | null; name: string }, template: string): string {
  // Verbatim when the crawl gave us one · including the 125 over-long titles. Trimming them is a
  // Phase 2 change made deliberately in the admin editor, not silently here.
  const stored = entity.seoTitle;
  if (typeof stored === "string" && stored !== "") return stored;
  return template.includes("%s") ? template.replace("%s", entity.name) : entity.name;
}

export function descriptionFor(entity: { seoDescription?: string | null; text?: string | null }): string | undefined {
  const stored = entity.seoDescription;
  if (typeof stored === "string" && stored !== "") return stored;
  // `text` is accepted so a caller can pass the body it already has, but it is deliberately NOT
  // used as a fallback: see the rules above.
  return undefined;
}

export function noindexMeta(title: string): Metadata {
  return {
    title,
    alternates: { canonical: "" },
    robots: "noindex, nofollow",
    openGraph: { title, type: "website", url: "", siteName: "", locale: "fa_IR", images: [] },
    twitter: { card: "summary_large_image", title, images: [] },
  };
}

export function plpMeta(base: MetaInput, state: PlpState): MetaInput {
  const page = state.page ?? 1;
  const filtered = isFilteredState(state);

  // the spec: a filtered URL renders 200 with `noindex, follow` and canonicalises to the
  // unfiltered listing; `?page=N` is indexable with a self-canonical and a numbered title.
  if (filtered) {
    return { ...base, robots: NOINDEX_FOLLOW, path: decPath(base.path) };
  }
  if (page <= 1) return base;
  return {
    ...base,
    path: decPath(plpUrl(base.path, { page })),
    title: base.title === null ? null : `${base.title} · صفحهٔ ${faInt(page)}`,
  };
}
