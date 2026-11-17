import { htmlToText } from "../html/text";
import { ROUTES, absUrl, decPath, encPath } from "../url";
import type {
  Crumb,
  ImageRef,
  PostView,
  ProductDetail,
  StoreContactSetting,
  StoreHoursSetting,
  StoreInfoSetting,
} from "../types";

export type JsonLdCtx = { origin: string; siteName: string; store: StoreInfoSetting & StoreContactSetting & { instagram: string }; mediaUrl(key: string): string };

// ---------------------------------------------------------------- constants

/** The only `@context` this project ever emits. */
const SCHEMA_CONTEXT = "https://schema.org";
/** Enumeration prefix - schema.org enumeration members are absolute IRIs. */
const S = "https://schema.org/";
const LANG = "fa-IR";

/** the spec contract: `description(text ≤ 5000)`. Applied to every free-text description. */
const DESCRIPTION_MAX = 5000;
/** Google truncates `headline` past 110 characters (legacy `articleNode` sliced at the same point). */
const HEADLINE_MAX = 110;
/** the spec contract: `CollectionPage + ItemList (first 50)`. */
const ITEM_LIST_MAX = 50;

/**
 * DECISION: the spec and catalog/cards.ts
 * ("seo/jsonld.ts applies its own ≥ 3 rule") require the guard here, while this module only says
 * "aggregateRating when given". The guard is kept - a rich-result rating built on 1 review is a
 * Google structured-data-policy risk, so the more secure reading wins. The threshold is NOT
 * imported from ../reviews/reviews (MIN_REVIEWS_FOR_AGGREGATE): dependency list limits this module to
 * ../url, ../html/text and ../types, and pulling a DB-facing module into a pure SEO builder would
 * widen the boundary of the spec
 */
const MIN_REVIEWS_FOR_AGGREGATE = 3;

/**
 * DECISION: the logo stays the legacy first-party PWA icon (`/icons/icon-512.png`, 512×512, the spec
 * §"manifest") instead of going through `ctx.mediaUrl` - the wordmark icon is a build asset of
 * apps/web, not a row of the media table, so it has no storage key.
 */
const LOGO_PATH = "/icons/icon-512.png";
const LOGO_SIZE = 512;

/**
 * DECISION: the locality/country of the PostalAddress are constants (as in the legacy `orgNode`):
 * `store.contact.address` is one free-text Persian line and parsing a city out of it would be
 * guesswork. The store is a single physical shop in Tehran.
 */
const ADDRESS_LOCALITY = "تهران";
const ADDRESS_COUNTRY = "IR";

/** `sameAs` is a link value in structured data, never a fetched/loaded origin (the spec CSP rule). */
const INSTAGRAM_ORIGIN = "https://www.instagram.com";

/**
 * `store.hours.days` keys → the schema.org DayOfWeek members, in the settings shape's own order
 * (the Persian week starts on Saturday), so a grouped opening-hours entry lists its days the way
 * the shop reads them out.
 */
const DAY_OF_WEEK: readonly { key: keyof StoreHoursSetting["days"]; iri: string }[] = [
  { key: "sat", iri: `${S}Saturday` },
  { key: "sun", iri: `${S}Sunday` },
  { key: "mon", iri: `${S}Monday` },
  { key: "tue", iri: `${S}Tuesday` },
  { key: "wed", iri: `${S}Wednesday` },
  { key: "thu", iri: `${S}Thursday` },
  { key: "fri", iri: `${S}Friday` },
];

/**
 * OPEN #30: the legacy site published the Toman amount with `priceCurrency: "IRT"`.
 * Parity at launch; the switch to IRR (amount ×10) is a Phase 2 decision for the owner.
 */
const PRICE_CURRENCY = "IRT";

// ---------------------------------------------------------------- internals

type Node = Record<string, unknown>;

const ABSOLUTE_URL_RE = /^https?:\/\//i;
const NON_DIGIT_RE = /[^0-9]/g;

/** `origin` + a site-relative path; already-absolute URLs (a future media CDN) pass through. */
function toAbs(ctx: JsonLdCtx, url: string): string {
  if (ABSOLUTE_URL_RE.test(url)) return url;
  return absUrl(ctx.origin, url.startsWith("/") ? url : `/${url}`);
}

/**
 * The canonical absolute URL of a page path.
 * DECISION: `encPath(decPath(path))` rather than the bare `encPath(path)` of metadata.ts - it is
 * the idempotent canonical form (`isEncodedCanonical` is defined as exactly this fixed point), so a
 * caller that hands over an already-encoded path cannot produce a double-encoded `%25d8` `@id`.
 * A missing leading "/" is added instead of throwing: a malformed crumb must not break a page render.
 */
function pageUrlOf(ctx: JsonLdCtx, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return absUrl(ctx.origin, encPath(decPath(p)));
}

const orgId = (ctx: JsonLdCtx): string => absUrl(ctx.origin, "/#organization");
const websiteId = (ctx: JsonLdCtx): string => absUrl(ctx.origin, "/#website");
const logoId = (ctx: JsonLdCtx): string => absUrl(ctx.origin, "/#logo");

/** Cut at a word boundary and mark the cut; the result is never longer than `max`. */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * rules: "Description text comes from htmlToText(descriptionHtml) - never raw HTML."
 * DECISION: every free-text field of every builder goes through htmlToText, not only the product
 * description - the sanitizer runs at write time, but a legacy `seo_description` may still carry
 * markup and structured data must be plain text. htmlToText is a no-op on text without tags.
 */
function textOf(html: string | null | undefined, max = DESCRIPTION_MAX): string {
  if (typeof html !== "string" || html === "") return "";
  return cap(htmlToText(html), max);
}

/**
 * "02155550000" → "+982155550000" (the legacy `+98${phone.slice(1)}`), tolerant of separators and
 * of the 0098/98 prefixes. Latin digits only - settings store the normalized ASCII form.
 */
function toE164(phone: string | undefined): string | null {
  const digits = (phone ?? "").replace(NON_DIGIT_RE, "");
  if (digits === "") return null;
  let national = digits;
  if (national.startsWith("0098")) national = national.slice(4);
  else if (national.startsWith("98") && national.length > 10) national = national.slice(2);
  national = national.replace(/^0+/, "");
  return national === "" ? null : `+98${national}`;
}

/** "namilux.ir" / "@namilux.ir" → the profile URL; an already absolute URL passes through. */
function instagramUrl(handle: string | undefined): string | null {
  const h = (handle ?? "").trim().replace(/^@+/, "").replace(/\/+$/, "");
  if (h === "") return null;
  return ABSOLUTE_URL_RE.test(h) ? h : `${INSTAGRAM_ORIGIN}/${h}`;
}

/**
 * EDGE CASE: "Products without images → image omitted (not an empty array)."
 * The primary image comes first (Google uses the first entry), then the gallery, de-duplicated by
 * storage key so a gallery that repeats the primary image does not repeat the URL.
 */
function imageUrls(p: ProductDetail, ctx: JsonLdCtx): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const refs: (ImageRef | undefined)[] = [p.image, ...p.gallery];
  for (const ref of refs) {
    if (!ref || ref.key === "" || seen.has(ref.key)) continue;
    seen.add(ref.key);
    urls.push(toAbs(ctx, ctx.mediaUrl(ref.key)));
  }
  return urls;
}

/**
 * InStock | PreOrder (backorder allowed) | OutOfStock - contract of `product`.
 * `ProductCard.available` is a boolean by design (the spec: the exact quantity never leaves the
 * server), so the mapping reads the flag, not a count.
 */
function availabilityOf(p: ProductDetail): string {
  if (p.available) return `${S}InStock`;
  return p.allowBackorder ? `${S}PreOrder` : `${S}OutOfStock`;
}

function organizationNode(ctx: JsonLdCtx): Node {
  const name = ctx.siteName.trim() === "" ? ctx.store.brandName : ctx.siteName.trim();
  const telephone = toE164(ctx.store.phoneMobile);
  const instagram = instagramUrl(ctx.store.instagram);
  const legalName = ctx.store.legalName.trim();
  return {
    // LocalBusiness subtype so the physical store ranks locally.
    "@type": ["Organization", "HomeGoodsStore"],
    "@id": orgId(ctx),
    name,
    ...(legalName !== "" && legalName !== name ? { legalName } : {}),
    url: absUrl(ctx.origin, ROUTES.home),
    logo: {
      "@type": "ImageObject",
      "@id": logoId(ctx),
      url: absUrl(ctx.origin, LOGO_PATH),
      width: LOGO_SIZE,
      height: LOGO_SIZE,
      caption: name,
    },
    ...(telephone === null ? {} : { telephone }),
    ...(ctx.store.email.trim() === "" ? {} : { email: ctx.store.email.trim() }),
    address: {
      "@type": "PostalAddress",
      streetAddress: ctx.store.address,
      addressLocality: ADDRESS_LOCALITY,
      addressCountry: ADDRESS_COUNTRY,
    },
    ...(instagram === null ? {} : { sameAs: [instagram] }),
  };
}

/**
 * `store.hours` → `OpeningHoursSpecification[]`, one entry per DISTINCT window rather than one per
 * day: seven identical «۱۰:۰۰–۲۱:۰۰» rows is what the settings default actually holds, and Google
 * reads the grouped form the same way while a human reading the source can see the shop's week.
 * A `null` day is closed and is simply absent - schema.org has no "closed" member, and an entry
 * with equal `opens`/`closes` is read as *open around the clock*, which would be a lie.
 */
function openingHours(hours: StoreHoursSetting): Node[] {
  const groups = new Map<string, { opens: string; closes: string; days: string[] }>();
  for (const day of DAY_OF_WEEK) {
    const window = hours.days[day.key];
    if (window === null) continue;
    const key = `${window.open}-${window.close}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { opens: window.open, closes: window.close, days: [day.iri] });
    else group.days.push(day.iri);
  }
  return [...groups.values()].map((g) => ({
    "@type": "OpeningHoursSpecification",
    // A single day stays a string; schema.org accepts either and the one-element array reads worse.
    dayOfWeek: g.days.length === 1 ? g.days[0] : g.days,
    opens: g.opens,
    closes: g.closes,
  }));
}

function webSiteNode(ctx: JsonLdCtx): Node {
  const home = absUrl(ctx.origin, ROUTES.home);
  return {
    "@type": "WebSite",
    "@id": websiteId(ctx),
    url: home,
    name: ctx.siteName,
    publisher: { "@id": orgId(ctx) },
    inLanguage: LANG,
    potentialAction: {
      "@type": "SearchAction",
      // The placeholder must stay literal - it is a template, not a URL segment to encode.
      target: { "@type": "EntryPoint", urlTemplate: `${absUrl(ctx.origin, ROUTES.search)}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

function makeGraph(nodes: object[]): { "@context": "https://schema.org"; "@graph": object[] } {
  return { "@context": SCHEMA_CONTEXT, "@graph": nodes };
}

/** Shared by `jsonld.webPage` and `jsonld.collection` (a CollectionPage IS a WebPage). */
function webPageNode(
  o: { path: string; title: string; description?: string; type?: "WebPage" | "ItemPage" | "CollectionPage" },
  ctx: JsonLdCtx,
): Node {
  const url = pageUrlOf(ctx, o.path);
  const description = textOf(o.description);
  return {
    "@type": o.type ?? "WebPage",
    "@id": url,
    url,
    name: o.title,
    ...(description === "" ? {} : { description }),
    isPartOf: { "@id": websiteId(ctx) },
    inLanguage: LANG,
    breadcrumb: { "@id": `${url}#breadcrumb` },
  };
}

// ---------------------------------------------------------------- contract

/**
 * `<`, `>` and `&` become their \u escapes so the payload can never close the surrounding
 * `<script type="application/ld+json">`.
 * DECISION: U+2028/U+2029 are escaped too. They are legal inside a JSON string but terminate a line
 * in some JS parsers; escaping them costs one character class and removes the whole family of
 * "valid JSON, broken script" bugs.
 */
const SCRIPT_ESCAPES: Readonly<Record<string, string>> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
const SCRIPT_ESCAPE_RE = /[<>&\u2028\u2029]/g;

export function serializeJsonLd(o: object): string {
  return JSON.stringify(o).replace(SCRIPT_ESCAPE_RE, (c) => SCRIPT_ESCAPES[c] ?? c);
}

export const jsonld = {
  /**
   * The two site-wide nodes.
   * DECISION: this returns a complete `@graph` document (as the lifted `orgSiteGraph()` did) rather
   * than a single node, because the contract requires it to carry TWO nodes (Organization + WebSite)
   * and a single `object` cannot be spread into `graph([...])`. It is emitted once from the layout;
   * every page node then references `{ "@id": origin + "/#website" | "/#organization" }`.
   */
  orgSite(ctx: JsonLdCtx): object {
    return makeGraph([organizationNode(ctx), webSiteNode(ctx)]);
  },

  /**
   * DECISION: `Crumb.href` is already percent-encoded (types/common: "href already url-encoded by
   * url/*"), so it is only made absolute - re-running encPath would turn "%d8%aa" into "%25d8%25aa".
   * The last crumb carries no `item` (it is the current page), per the lifted builder and Google's
   * breadcrumb guidance.
   */
  breadcrumb(crumbs: Crumb[], pagePath: string, ctx: JsonLdCtx): object {
    const url = pageUrlOf(ctx, pagePath);
    return {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: crumbs.map((c, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: c.name,
        ...(idx < crumbs.length - 1 ? { item: toAbs(ctx, c.href) } : {}),
      })),
    };
  },

  webPage(
    o: { path: string; title: string; description?: string; type?: "WebPage" | "ItemPage" | "CollectionPage" },
    ctx: JsonLdCtx,
  ): object {
    return webPageNode(o, ctx);
  },

  /**
   * EDGE CASE: variants are display-only - each colour keeps its own Product node and its own
   * canonical `@id`; no ProductGroup node is emitted at launch.
   */
  product(
    p: ProductDetail,
    o: { path: string; rating?: { ratingValue: number; reviewCount: number } | null },
    ctx: JsonLdCtx,
  ): object {
    const url = pageUrlOf(ctx, o.path);
    const images = imageUrls(p, ctx);
    const sku = (p.sku ?? "").trim();
    // DECISION: the Persian brand name is used (the lifted `productNode` emitted `p.brand`, which was
    // the Persian name; `brandEn` was a separate field it did not publish). nameEn stays out of the
    // node so the launch output is byte-comparable with the legacy one. `brand` is nullable (33
    // legacy products have no brand) → the Brand sub-node is simply omitted.
    const brandName = p.brand === null ? "" : p.brand.name.trim();
    const description = textOf(p.descriptionHtml);
    const rating = o.rating;
    const node: Node = {
      "@type": "Product",
      "@id": `${url}#product`,
      name: p.name,
      url,
      ...(images.length === 0 ? {} : { image: images }),
      ...(sku === "" ? {} : { sku }),
      ...(brandName === "" ? {} : { brand: { "@type": "Brand", name: brandName } }),
      ...(description === "" ? {} : { description }),
    };
    // rules: an Offer is never emitted for price 0 - the 283 on-request products publish a Product
    // node without an Offer, because a `price: 0` offer is worse than no offer at all.
    if (p.price > 0) {
      node.offers = {
        "@type": "Offer",
        price: String(p.price),
        priceCurrency: PRICE_CURRENCY,
        availability: availabilityOf(p),
        url,
        itemCondition: `${S}NewCondition`,
      };
    }
    if (rating && rating.reviewCount >= MIN_REVIEWS_FOR_AGGREGATE && rating.ratingValue > 0) {
      node.aggregateRating = {
        "@type": "AggregateRating",
        // one decimal - an unrounded 4.333333333333333 is noise in a rich result
        ratingValue: Math.round(rating.ratingValue * 10) / 10,
        reviewCount: rating.reviewCount,
      };
    }
    return node;
  },

  /**
   * DECISION: one node, not two - the CollectionPage carries the ItemList as its `mainEntity`, so
   * the builder's result stays composable through `graph([...])` like every other node builder.
   */
  collection(c: { path: string; name: string; description?: string }, items: { url: string; name: string }[], ctx: JsonLdCtx): object {
    const url = pageUrlOf(ctx, c.path);
    const listed = items.slice(0, ITEM_LIST_MAX);
    // `exactOptionalPropertyTypes` - `description` is passed only when the caller gave one.
    const page = webPageNode(
      { path: c.path, title: c.name, type: "CollectionPage", ...(c.description === undefined ? {} : { description: c.description }) },
      ctx,
    );
    return {
      ...page,
      mainEntity: {
        "@type": "ItemList",
        "@id": `${url}#itemlist`,
        numberOfItems: listed.length,
        itemListElement: listed.map((item, idx) => ({
          "@type": "ListItem",
          position: idx + 1,
          name: item.name,
          url: toAbs(ctx, item.url),
        })),
      },
    };
  },

  /**
   * DECISION: `author` is the real `authorName` as a Person (the header lists "author" and PostView
   * carries the name); it falls back to the Organization reference the legacy builder used when the
   * post has no author. `mainEntityOfPage` references the WebPage node by `@id` (Yoast shape, WHAT).
   */
  post(p: PostView, o: { path: string }, ctx: JsonLdCtx): object {
    const url = pageUrlOf(ctx, o.path);
    const author = p.authorName.trim();
    const description = textOf(p.excerpt);
    return {
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      headline: cap(p.title, HEADLINE_MAX),
      mainEntityOfPage: { "@id": url },
      url,
      // legacy dates are preserved verbatim - never the build date
      datePublished: p.publishedAt,
      dateModified: p.updatedAt,
      ...(description === "" ? {} : { description }),
      ...(p.cover === null ? {} : { image: [toAbs(ctx, ctx.mediaUrl(p.cover.key))] }),
      author: author === "" ? { "@id": orgId(ctx) } : { "@type": "Person", name: author },
      publisher: { "@id": orgId(ctx) },
      inLanguage: LANG,
    };
  },

  /**
   * The physical shop, for the About page: the Organization node again, plus the three things only
   * a page about the shop itself can state - when it is open, where its map pin is, and which page
   * is *about* it.
   *
   * DECISION: it carries the SAME `@id` as `orgSite`'s organization node instead of minting a
   * second `#store` node. There is one legal entity and one address; two nodes would make a
   * consumer choose between them, while two nodes sharing an `@id` merge into one - which is
   * exactly the relationship here (the layout's node is emitted on every page, this one adds the
   * opening hours on the single page that talks about them). `@type` is repeated verbatim from
   * `organizationNode` so the merged node can never end up with two different type sets.
   *
   * EDGE CASE: an empty `store.contact.mapUrl` drops `hasMap` rather than emitting `""` - the same
   * rule the page's own «مسیریابی» link follows.
   */
  localBusiness(o: { path: string; hours: StoreHoursSetting }, ctx: JsonLdCtx): object {
    const org = organizationNode(ctx);
    const hours = openingHours(o.hours);
    const map = ctx.store.mapUrl.trim();
    return {
      ...org,
      ...(hours.length === 0 ? {} : { openingHoursSpecification: hours }),
      ...(map === "" ? {} : { hasMap: map }),
      mainEntityOfPage: { "@id": pageUrlOf(ctx, o.path) },
    };
  },

  /**
   * FAQPage. Answers are plain text by contract; htmlToText is applied here as well so a caller that
   * forgets `content/faq.answerText` cannot publish markup inside `acceptedAnswer.text`.
   * A pair with an empty question or answer is dropped - Google requires both.
   */
  faq(items: { q: string; a: string }[]): object {
    const mainEntity = items
      .map((i) => ({ q: textOf(i.q), a: textOf(i.a) }))
      .filter((i) => i.q !== "" && i.a !== "")
      .map((i) => ({
        "@type": "Question",
        name: i.q,
        acceptedAnswer: { "@type": "Answer", text: i.a },
      }));
    return { "@type": "FAQPage", mainEntity };
  },

  graph(nodes: object[]): { "@context": "https://schema.org"; "@graph": object[] } {
    return makeGraph(nodes);
  },
};
