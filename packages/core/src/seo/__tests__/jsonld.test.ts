import { describe, expect, it } from "vitest";
import type { Crumb, ImageRef, PostView, ProductDetail } from "../../types";
import { type JsonLdCtx, jsonld, serializeJsonLd } from "../jsonld";

// ---------------------------------------------------------------- fixtures

const ctx: JsonLdCtx = {
  origin: "https://namilux.ir",
  siteName: "نامی لوکس",
  store: {
    legalName: "نامی لوکس",
    brandName: "نامی لوکس",
    wordmark: "نامی‌لوکس",
    economicCode: "",
    registrationNo: "",
    vatId: "",
    phoneMobile: "09121230077",
    phoneLand: "02155550000",
    whatsapp: "989121230077",
    email: "",
    address: "تهران، میدان شوش، خیابان صابونیان، پاساژ الماس بلورین، طبقهٔ دوم، پلاک ۶۴۲",
    mapUrl: "",
    instagram: "namilux.ir",
  },
  mediaUrl: (key: string) => `/media/${key}`,
};

const image = (key: string): ImageRef => ({ key, alt: "", width: 1200, height: 1200 });

const PRODUCT_BASE: ProductDetail = {
  id: 12,
  slug: "کتری-برقی-اسمگ",
  displayName: "کتری برقی اسمگ",
  brand: { slug: "smeg", name: "اسمگ", nameEn: "Smeg" },
  price: 41_500_000,
  onRequest: false,
  available: true,
  lowStock: false,
  badges: [],
  variants: [],
  publishedAt: "2024-05-01T00:00:00.000Z",
  salesRank: 0,
  name: "کتری برقی اسمگ مدل KLF04",
  sku: "KLF04PBEU",
  shortHtml: "<p>کوتاه</p>",
  descriptionHtml: "<p>بدنه <strong>فولادی</strong></p><p>گرم‌کن سریع</p>",
  specs: [],
  categories: [],
  collections: [],
  related: [],
  accessories: [],
  siblings: [],
  gallery: [],
  maxPerOrder: 5,
  allowBackorder: false,
  status: "active",
  visibility: "public",
  seo: { title: null, description: null, robots: "index, follow", canonical: "", ogImage: null, lastmod: null },
  jsonld: {},
};

const product = (patch: Partial<ProductDetail> = {}): ProductDetail => ({ ...PRODUCT_BASE, ...patch });

const PRODUCT_PATH = "/product/کتری-برقی-اسمگ/";
/** the encoded canonical of PRODUCT_PATH - lowercase hex, trailing slash */
const PRODUCT_URL =
  "https://namilux.ir/product/%da%a9%d8%aa%d8%b1%db%8c-%d8%a8%d8%b1%d9%82%db%8c-%d8%a7%d8%b3%d9%85%da%af/";

const POST: PostView = {
  id: 7,
  slug: "آموزش-توستر",
  title: "آموزش طرز استفاده از توستر اسمگ",
  excerpt: "<p>راهنمای کوتاه</p>",
  cover: image("posts/7/cover.avif"),
  publishedAt: "2021-03-14T08:20:00.000Z",
  readMinutes: 6,
  tags: ["توستر"],
  bodyHtml: "<p>متن</p>",
  authorName: "سردبیر",
  status: "published",
  relatedProductIds: [],
  seo: { title: null, description: null, robots: "index, follow", canonical: "", ogImage: null, lastmod: null },
  updatedAt: "2023-11-02T09:00:00.000Z",
};

type Node = Record<string, unknown>;
const asNode = (o: object): Node => o as Node;
const nodesOf = (o: object): Node[] => (asNode(o)["@graph"] as Node[]);

// ---------------------------------------------------------------- orgSite

describe("orgSite", () => {
  const graph = jsonld.orgSite(ctx);
  const [org, site] = nodesOf(graph);

  it("organization node snapshot matches the legacy shape", () => {
    expect(asNode(graph)["@context"]).toBe("https://schema.org");
    expect(nodesOf(graph)).toHaveLength(2);
    expect(org).toEqual({
      "@type": ["Organization", "HomeGoodsStore"],
      "@id": "https://namilux.ir/#organization",
      name: "نامی لوکس",
      url: "https://namilux.ir/",
      logo: {
        "@type": "ImageObject",
        "@id": "https://namilux.ir/#logo",
        url: "https://namilux.ir/icons/icon-512.png",
        width: 512,
        height: 512,
        caption: "نامی لوکس",
      },
      telephone: "+989121230077",
      address: {
        "@type": "PostalAddress",
        streetAddress: ctx.store.address,
        addressLocality: "تهران",
        addressCountry: "IR",
      },
      sameAs: ["https://www.instagram.com/namilux.ir"],
    });
  });

  it("website node carries the SearchAction with a literal search_term_string template", () => {
    expect(site).toEqual({
      "@type": "WebSite",
      "@id": "https://namilux.ir/#website",
      url: "https://namilux.ir/",
      name: "نامی لوکس",
      publisher: { "@id": "https://namilux.ir/#organization" },
      inLanguage: "fa-IR",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: "https://namilux.ir/search/?q={search_term_string}" },
        "query-input": "required name=search_term_string",
      },
    });
  });

  it("falls back to the mobile number and omits sameAs when there is no handle", () => {
    const bare = jsonld.orgSite({
      ...ctx,
      store: { ...ctx.store, phoneLand: "", instagram: "  ", legalName: "نامی لوکس بلور شرق", email: "hi@namilux.ir" },
    });
    const [node] = nodesOf(bare);
    expect(node?.telephone).toBe("+989121230077");
    expect(node).not.toHaveProperty("sameAs");
    expect(node?.legalName).toBe("نامی لوکس بلور شرق");
    expect(node?.email).toBe("hi@namilux.ir");
  });

  it("a trailing slash on the origin never doubles up", () => {
    const [node] = nodesOf(jsonld.orgSite({ ...ctx, origin: "https://namilux.ir/" }));
    expect(node?.["@id"]).toBe("https://namilux.ir/#organization");
    expect(node?.url).toBe("https://namilux.ir/");
  });
});

// ---------------------------------------------------------------- breadcrumb

describe("breadcrumb", () => {
  const crumbs: Crumb[] = [
    { name: "خانه", href: "/" },
    { name: "فروشگاه", href: "/shop/" },
    { name: "کتری برقی اسمگ", href: "/product/%da%a9%d8%aa%d8%b1%db%8c-%d8%a8%d8%b1%d9%82%db%8c-%d8%a7%d8%b3%d9%85%da%af/" },
  ];

  it("numbers the items from 1 and leaves the last one without an item link", () => {
    const node = asNode(jsonld.breadcrumb(crumbs, PRODUCT_PATH, ctx));
    expect(node["@type"]).toBe("BreadcrumbList");
    expect(node["@id"]).toBe(`${PRODUCT_URL}#breadcrumb`);
    expect(node.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "خانه", item: "https://namilux.ir/" },
      { "@type": "ListItem", position: 2, name: "فروشگاه", item: "https://namilux.ir/shop/" },
      { "@type": "ListItem", position: 3, name: "کتری برقی اسمگ" },
    ]);
  });

  it("does not re-encode an already encoded crumb href", () => {
    const node = asNode(jsonld.breadcrumb([...crumbs, { name: "آخر", href: "/x/" }], PRODUCT_PATH, ctx));
    const items = node.itemListElement as Node[];
    expect(items[2]?.item).toBe(PRODUCT_URL);
    expect(JSON.stringify(node)).not.toContain("%25");
  });

  it("accepts an empty crumb list", () => {
    expect(asNode(jsonld.breadcrumb([], "/shop/", ctx)).itemListElement).toEqual([]);
  });
});

// ---------------------------------------------------------------- webPage

describe("webPage", () => {
  it("defaults to WebPage and references the website and its breadcrumb", () => {
    const node = asNode(jsonld.webPage({ path: "/shop/", title: "فروشگاه" }, ctx));
    expect(node).toEqual({
      "@type": "WebPage",
      "@id": "https://namilux.ir/shop/",
      url: "https://namilux.ir/shop/",
      name: "فروشگاه",
      isPartOf: { "@id": "https://namilux.ir/#website" },
      inLanguage: "fa-IR",
      breadcrumb: { "@id": "https://namilux.ir/shop/#breadcrumb" },
    });
  });

  it("honours the requested type and reduces a description to plain text", () => {
    const node = asNode(
      jsonld.webPage({ path: PRODUCT_PATH, title: "کتری", description: "<p>خط <b>یک</b></p><p>خط دو</p>", type: "ItemPage" }, ctx),
    );
    expect(node["@type"]).toBe("ItemPage");
    expect(node["@id"]).toBe(PRODUCT_URL);
    expect(node.description).toBe("خط یک خط دو");
  });

  it("omits an empty description", () => {
    expect(asNode(jsonld.webPage({ path: "/shop/", title: "فروشگاه", description: "" }, ctx))).not.toHaveProperty(
      "description",
    );
  });
});

// ---------------------------------------------------------------- product

describe("product", () => {
  it("builds the full node with an Offer when a price exists", () => {
    const node = asNode(
      jsonld.product(product({ gallery: [image("p/12/1.avif")], image: image("p/12/1.avif") }), { path: PRODUCT_PATH }, ctx),
    );
    expect(node).toEqual({
      "@type": "Product",
      "@id": `${PRODUCT_URL}#product`,
      name: "کتری برقی اسمگ مدل KLF04",
      url: PRODUCT_URL,
      image: ["https://namilux.ir/media/p/12/1.avif"],
      sku: "KLF04PBEU",
      brand: { "@type": "Brand", name: "اسمگ" },
      description: "بدنه فولادی گرم‌کن سریع",
      offers: {
        "@type": "Offer",
        price: "41500000",
        priceCurrency: "IRT",
        availability: "https://schema.org/InStock",
        url: PRODUCT_URL,
        itemCondition: "https://schema.org/NewCondition",
      },
    });
  });

  it("product without price has no offers", () => {
    const node = asNode(jsonld.product(product({ price: 0, onRequest: true }), { path: PRODUCT_PATH }, ctx));
    expect(node).not.toHaveProperty("offers");
    expect(node["@type"]).toBe("Product");
    expect(JSON.stringify(node)).not.toContain("IRT");
  });

  it("availability maps in stock / out of stock / backorder", () => {
    const table: { available: boolean; allowBackorder: boolean; expected: string }[] = [
      { available: true, allowBackorder: false, expected: "https://schema.org/InStock" },
      { available: true, allowBackorder: true, expected: "https://schema.org/InStock" },
      { available: false, allowBackorder: false, expected: "https://schema.org/OutOfStock" },
      { available: false, allowBackorder: true, expected: "https://schema.org/PreOrder" },
    ];
    for (const row of table) {
      const node = asNode(
        jsonld.product(product({ available: row.available, allowBackorder: row.allowBackorder }), { path: PRODUCT_PATH }, ctx),
      );
      expect((node.offers as Node).availability, JSON.stringify(row)).toBe(row.expected);
    }
  });

  it("omits image entirely when the product has none (never an empty array)", () => {
    const node = asNode(jsonld.product(product(), { path: PRODUCT_PATH }, ctx));
    expect(node).not.toHaveProperty("image");
  });

  it("puts the primary image first and de-duplicates the gallery", () => {
    const node = asNode(
      jsonld.product(
        product({ image: image("p/12/1.avif"), gallery: [image("p/12/2.avif"), image("p/12/1.avif")] }),
        { path: PRODUCT_PATH },
        ctx,
      ),
    );
    expect(node.image).toEqual(["https://namilux.ir/media/p/12/1.avif", "https://namilux.ir/media/p/12/2.avif"]);
  });

  it("omits sku and brand when the legacy row has neither", () => {
    const node = asNode(jsonld.product(product({ sku: null, brand: null }), { path: PRODUCT_PATH }, ctx));
    expect(node).not.toHaveProperty("sku");
    expect(node).not.toHaveProperty("brand");
  });

  it("emits AggregateRating only from three approved reviews upward", () => {
    const under = asNode(
      jsonld.product(product(), { path: PRODUCT_PATH, rating: { ratingValue: 5, reviewCount: 2 } }, ctx),
    );
    expect(under).not.toHaveProperty("aggregateRating");

    const none = asNode(jsonld.product(product(), { path: PRODUCT_PATH, rating: null }, ctx));
    expect(none).not.toHaveProperty("aggregateRating");

    const at = asNode(
      jsonld.product(product(), { path: PRODUCT_PATH, rating: { ratingValue: 4.333333333, reviewCount: 3 } }, ctx),
    );
    expect(at.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.3, reviewCount: 3 });
  });

  it("caps the description at 5000 characters", () => {
    const long = `<p>${"واژه ".repeat(3000)}</p>`;
    const node = asNode(jsonld.product(product({ descriptionHtml: long }), { path: PRODUCT_PATH }, ctx));
    const description = node.description as string;
    expect(description.length).toBeLessThanOrEqual(5000);
    expect(description.endsWith("…")).toBe(true);
    expect(description).not.toContain("<");
  });

  it("gives every colour variant its own Product node - no ProductGroup", () => {
    const black = asNode(jsonld.product(product({ slug: "kettle-black" }), { path: "/product/kettle-black/" }, ctx));
    const cream = asNode(jsonld.product(product({ slug: "kettle-cream" }), { path: "/product/kettle-cream/" }, ctx));
    expect(black["@id"]).toBe("https://namilux.ir/product/kettle-black/#product");
    expect(cream["@id"]).toBe("https://namilux.ir/product/kettle-cream/#product");
    expect(black["@id"]).not.toBe(cream["@id"]);
    expect(JSON.stringify([black, cream])).not.toContain("ProductGroup");
  });
});

// ---------------------------------------------------------------- collection

describe("collection", () => {
  const items = Array.from({ length: 73 }, (_, i) => ({ url: `/product/p-${i}/`, name: `کالا ${i}` }));

  it("collection ItemList is capped at 50", () => {
    const node = asNode(jsonld.collection({ path: "/brand/smeg/", name: "اسمگ" }, items, ctx));
    const list = node.mainEntity as Node;
    expect(node["@type"]).toBe("CollectionPage");
    expect(list["@type"]).toBe("ItemList");
    expect(list["@id"]).toBe("https://namilux.ir/brand/smeg/#itemlist");
    expect(list.numberOfItems).toBe(50);
    expect(list.itemListElement).toHaveLength(50);
    const elements = list.itemListElement as Node[];
    expect(elements[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "کالا 0",
      url: "https://namilux.ir/product/p-0/",
    });
    expect(elements[49]?.position).toBe(50);
    expect(JSON.stringify(elements)).not.toContain("p-50");
  });

  it("is a WebPage too: description, website reference and breadcrumb reference", () => {
    const node = asNode(jsonld.collection({ path: "/brand/smeg/", name: "اسمگ", description: "<p>داستان</p>" }, [], ctx));
    expect(node.description).toBe("داستان");
    expect(node.isPartOf).toEqual({ "@id": "https://namilux.ir/#website" });
    expect(node.breadcrumb).toEqual({ "@id": "https://namilux.ir/brand/smeg/#breadcrumb" });
    expect((node.mainEntity as Node).itemListElement).toEqual([]);
  });
});

// ---------------------------------------------------------------- post

describe("post", () => {
  it("keeps the legacy dates and names the real author", () => {
    const node = asNode(jsonld.post(POST, { path: "/آموزش-توستر/" }, ctx));
    const url = "https://namilux.ir/%d8%a2%d9%85%d9%88%d8%b2%d8%b4-%d8%aa%d9%88%d8%b3%d8%aa%d8%b1/";
    expect(node).toEqual({
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      headline: "آموزش طرز استفاده از توستر اسمگ",
      mainEntityOfPage: { "@id": url },
      url,
      datePublished: "2021-03-14T08:20:00.000Z",
      dateModified: "2023-11-02T09:00:00.000Z",
      description: "راهنمای کوتاه",
      image: ["https://namilux.ir/media/posts/7/cover.avif"],
      author: { "@type": "Person", name: "سردبیر" },
      publisher: { "@id": "https://namilux.ir/#organization" },
      inLanguage: "fa-IR",
    });
  });

  it("falls back to the organization as author and omits a missing cover", () => {
    const node = asNode(jsonld.post({ ...POST, authorName: "  ", cover: null, excerpt: "" }, { path: "/x/" }, ctx));
    expect(node.author).toEqual({ "@id": "https://namilux.ir/#organization" });
    expect(node).not.toHaveProperty("image");
    expect(node).not.toHaveProperty("description");
  });

  it("truncates the headline at 110 characters", () => {
    const node = asNode(jsonld.post({ ...POST, title: "واژه ".repeat(40) }, { path: "/x/" }, ctx));
    expect((node.headline as string).length).toBeLessThanOrEqual(110);
  });
});

// ---------------------------------------------------------------- faq

describe("localBusiness", () => {
  const HOURS = {
    days: {
      sat: { open: "10:00", close: "21:00" },
      sun: { open: "10:00", close: "21:00" },
      mon: { open: "10:00", close: "21:00" },
      tue: { open: "10:00", close: "21:00" },
      wed: { open: "10:00", close: "21:00" },
      thu: { open: "10:00", close: "21:00" },
      fri: null,
    },
    note: "همه‌روزه ۱۰ تا ۲۱",
  };

  it("is the organization node again - same @id and @type, so the two graphs merge into one", () => {
    const node = asNode(jsonld.localBusiness({ path: "/about-us/", hours: HOURS }, ctx));
    const org = nodesOf(jsonld.orgSite(ctx))[0] as Node;
    expect(node["@id"]).toBe(org["@id"]);
    expect(node["@type"]).toEqual(org["@type"]);
    expect(node["telephone"]).toBe("+989121230077");
    expect(node["address"]).toEqual(org["address"]);
    expect(node["mainEntityOfPage"]).toEqual({ "@id": "https://namilux.ir/about-us/" });
  });

  it("groups identical days into one OpeningHoursSpecification and omits a closed one", () => {
    const node = asNode(jsonld.localBusiness({ path: "/about-us/", hours: HOURS }, ctx));
    expect(node["openingHoursSpecification"]).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "https://schema.org/Saturday",
          "https://schema.org/Sunday",
          "https://schema.org/Monday",
          "https://schema.org/Tuesday",
          "https://schema.org/Wednesday",
          "https://schema.org/Thursday",
        ],
        opens: "10:00",
        closes: "21:00",
      },
    ]);
  });

  it("a single day stays a string, and two windows become two entries", () => {
    const hours = {
      ...HOURS,
      days: { ...HOURS.days, fri: { open: "16:00", close: "21:00" } },
    };
    const spec = asNode(jsonld.localBusiness({ path: "/about-us/", hours }, ctx))[
      "openingHoursSpecification"
    ] as Record<string, unknown>[];
    expect(spec).toHaveLength(2);
    expect(spec[1]).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "https://schema.org/Friday",
      opens: "16:00",
      closes: "21:00",
    });
  });

  it("a week with every day closed emits no openingHoursSpecification at all", () => {
    const closed = {
      ...HOURS,
      days: { sat: null, sun: null, mon: null, tue: null, wed: null, thu: null, fri: null },
    };
    expect(asNode(jsonld.localBusiness({ path: "/about-us/", hours: closed }, ctx))).not.toHaveProperty(
      "openingHoursSpecification",
    );
  });

  it("hasMap follows store.contact.mapUrl and is omitted when it is empty", () => {
    expect(asNode(jsonld.localBusiness({ path: "/about-us/", hours: HOURS }, ctx))).not.toHaveProperty("hasMap");
    const withMap = asNode(
      jsonld.localBusiness(
        { path: "/about-us/", hours: HOURS },
        { ...ctx, store: { ...ctx.store, mapUrl: "https://maps.example/?q=namilux" } },
      ),
    );
    expect(withMap["hasMap"]).toBe("https://maps.example/?q=namilux");
  });
});

describe("faq", () => {
  it("faq answers are plain text", () => {
    const node = asNode(
      jsonld.faq([
        { q: "<p>گارانتی چند ساله است؟</p>", a: "<ul><li>۱۸ ماه</li><li>در محل</li></ul>" },
        { q: "ارسال چقدر طول می‌کشد؟", a: "۱ تا ۷ روز کاری" },
      ]),
    );
    expect(node["@type"]).toBe("FAQPage");
    expect(node.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "گارانتی چند ساله است؟",
        acceptedAnswer: { "@type": "Answer", text: "۱۸ ماه در محل" },
      },
      {
        "@type": "Question",
        name: "ارسال چقدر طول می‌کشد؟",
        acceptedAnswer: { "@type": "Answer", text: "۱ تا ۷ روز کاری" },
      },
    ]);
    expect(JSON.stringify(node)).not.toContain("<li>");
  });

  it("drops pairs with an empty question or answer and accepts an empty list", () => {
    expect(asNode(jsonld.faq([{ q: "پرسش", a: "  " }, { q: "", a: "پاسخ" }])).mainEntity).toEqual([]);
    expect(asNode(jsonld.faq([])).mainEntity).toEqual([]);
  });
});

// ---------------------------------------------------------------- graph + serialize

describe("graph", () => {
  it("wraps nodes in the schema.org context", () => {
    const nodes = [jsonld.webPage({ path: "/shop/", title: "فروشگاه" }, ctx), jsonld.breadcrumb([], "/shop/", ctx)];
    expect(jsonld.graph(nodes)).toEqual({ "@context": "https://schema.org", "@graph": nodes });
    expect(jsonld.graph([])).toEqual({ "@context": "https://schema.org", "@graph": [] });
  });
});

describe("serializeJsonLd", () => {
  it("serialize escapes </script", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("escapes & and the line separators, and round-trips through JSON.parse", () => {
    const payload = { a: "x & y", b: "line\u2028sep\u2029ends" };
    const out = serializeJsonLd(payload);
    expect(out).not.toContain("&");
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(out).toContain("\\u0026");
    expect(JSON.parse(out)).toEqual(payload);
  });

  it("keeps Persian text unescaped and produces parseable output for a whole graph", () => {
    const out = serializeJsonLd(jsonld.graph([jsonld.product(product(), { path: PRODUCT_PATH }, ctx)]));
    expect(out).toContain("کتری برقی اسمگ");
    expect(JSON.parse(out)).toHaveProperty("@context", "https://schema.org");
  });
});
