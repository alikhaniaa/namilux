import { buildMetadata, decPath, jsonld, productUrl, recordNotFound, resolveRedirect } from "@namilux/core";
import { faDigits, imgSrc, GATEWAY_FOR_CHANNEL } from "@namilux/core/client";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { CHANNEL } from "@/lib/channel";
import { Breadcrumbs } from "@/components/product/Breadcrumbs";
import { BuyBox } from "@/components/product/BuyBox";
import { Description } from "@/components/product/Description";
import { DimensionDrawing } from "@/components/product/DimensionDrawing";
import { EditorialBand } from "@/components/product/EditorialBand";
import { Gallery } from "@/components/product/Gallery";
import { PdpHighlights, pickHighlights } from "@/components/product/PdpHighlights";
import { ProductAccordions } from "@/components/product/ProductAccordions";
import { Questions } from "@/components/product/Questions";
import { Reviews } from "@/components/product/Reviews";
import { RecentlyViewed } from "@/components/product/RecentlyViewed";
import { RelatedRail } from "@/components/product/RelatedRail";
import { SpecTable } from "@/components/product/SpecTable";
import { StickyBuyBar } from "@/components/product/StickyBuyBar";
import { VariantLinks } from "@/components/product/VariantLinks";
import { Bdi } from "@/components/ui/Bdi";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadProduct, loadQuestions, loadReviewSummary, loadReviews } from "@/server/loaders/catalog";
import { productParams } from "@/server/static-params";
import { loadBanners, loadFaqs } from "@/server/loaders/content";
import { loadSettings } from "@/server/loaders/settings";
import { db } from "@/lib/db";
import { env } from "@/env";

// DECISION: a blocking route, not a streamed shell. `cacheComponents` asks every route to
// prerender a static shell and stream the rest, but this page's whole body is a function of the
// URL (params/searchParams) and of Postgres - there is no part of it that is knowable at build
// time, and the spec does not describe a shell-plus-stream model for the catalogue: it renders
// the page from Postgres inside `use cache` and lets the CDN cache the finished HTML per URL
// (s-maxage 300, swr 86400). `instant = false` is Next's documented opt-out for exactly that
// shape; without it Next reports `blocking-prerender-runtime` on every request.
export const instant = false;

/**
 * DECISION (4 Sep 2026, performance review): under cacheComponents a dynamic segment WITHOUT
 * generateStaticParams treats its params as runtime data: every request resumes the render from the
 * fallback shell and nothing is stored per path (measured: ~25 ms of CPU per product page under
 * load, 40 req/s on one core). WITH it, the listed products are prerendered at build and any other
 * slug rendered at runtime is saved to disk after its first render - both served as static HTML
 * afterwards, revalidated by the loaders' tags and cacheLife. Sources: src/server/static-params.ts.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return productParams();
}

type Props = { params: Promise<{ slug: string }> };

const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = decPath((await params).slug);
  const [product, settings] = await Promise.all([loadProduct(slug), loadSettings()]);
  if (product === null) return { title: "" };

  const seo = settings["seo.defaults"];
  const meta = buildMetadata(
    {
      path: productUrl(product.slug),
      title: product.seo.title,
      description: product.seo.description,
      // `link_only` products are reachable by their URL but must never be indexed.
      robots: product.visibility === "link_only" ? "noindex, follow" : product.seo.robots,
      ogType: "product",
      ogImage: product.seo.ogImage,
      origin: env.SITE_ORIGIN,
      siteName: seo.siteName,
      titleTemplate: seo.titleTemplate,
    },
    { defaultOgKey: seo.defaultOgKey, mediaUrl },
  );
  // DECISION: `og:type` is stripped from what Next is given and emitted as a raw <meta> by the page
  // below. Next's metadata resolver validates the type against its own union and throws
  // "Invalid OpenGraph type: product" - but `product` is exactly what the legacy head published on
  // all 540 product URLs (data/extract/02_seo/seo_live.csv), and the spec is verbatim parity, so
  // the tag ships unchanged and only the route by which it reaches the head changes.
  const { type: _ogType, ...openGraph } = meta.openGraph ?? {};
  return {
    title: meta.title,
    description: meta.description,
    alternates: meta.alternates,
    robots: meta.robots,
    openGraph,
    twitter: meta.twitter,
  };
}

export default async function ProductPage({ params }: Props) {
  const slug = decPath((await params).slug);
  const product = await loadProduct(slug);

  if (product === null) {
    // Archiving a product writes its redirect row, so a retired URL is a 301 and not a 404.
    const path = productUrl(slug);
    // A miss is request time by definition (it is recorded with a timestamp and the driver draws
    // ids); `connection()` tells the prerenderer before the first uncached query (Next: blocking-prerender-*).
    // A build-time prerender of a slug that is gone (or the placeholder generateStaticParams returns
    // for an empty table) must not reach the request-time APIs below: a plain 404 is the right page.
    if (process.env.NEXT_PHASE === "phase-production-build") notFound();
    await connection();
    const hit = await resolveRedirect(db, path);
    if (hit !== null && hit.code === 301) permanentRedirect(hit.to);
    const referrer = (await headers()).get("referer") ?? undefined;
    void recordNotFound(db, path, referrer).catch(() => undefined);
    notFound();
  }

  const [settings, faqs, bands, reviewSummary, reviewPage, questionPage] = await Promise.all([
    loadSettings(),
    loadFaqs(`product:${String(product.id)}`),
    loadBanners("pdp_band"),
    loadReviewSummary(product.id),
    loadReviews(product.id, 1),
    loadQuestions(product.id),
  ]);
  const flags = settings.flags;

  const path = productUrl(product.slug);
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: settings["seo.defaults"].siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };
  const crumbs = product.categories;
  // UI v4.1: the at-a-glance card takes up to six short spec rows; the sheet below counts them all.
  // A product without a spec sheet (most of the legacy import) gets its identity card instead - 
  // brand, model, colour, warranty, category, code, availability - so the story column is never bare.
  const specRows = product.specs.reduce((n, g) => n + g.rows.length, 0);
  const fromSpecs = pickHighlights(product.specs, 6);
  const identity: { label: string; value: string }[] = [];
  if (product.brand !== null) identity.push({ label: t("plp.facet.brand"), value: product.brand.name });
  if (product.modelCode !== undefined) identity.push({ label: t("product.model"), value: product.modelCode });
  if (product.colorName !== undefined && product.colorName !== "") identity.push({ label: t("product.color"), value: product.colorName });
  if (product.warrantyMonths !== undefined && product.warrantyMonths > 0) identity.push({ label: t("product.warranty"), value: t("product.trust.warranty", { n: product.warrantyMonths }) });
  const leaf = crumbs[crumbs.length - 1];
  if (leaf !== undefined) identity.push({ label: t("product.category"), value: leaf.name });
  if (product.sku !== null) identity.push({ label: t("product.sku"), value: product.sku });
  identity.push({ label: t("plp.facet.availability"), value: t(product.available ? "product.stock.in" : "product.stock.out") });
  const glance = fromSpecs.length > 0 ? fromSpecs : identity;

  return (
    <>
      {/* The one head tag generateMetadata cannot carry - see the DECISION there. React hoists it
          into <head>, so the legacy `og:type` of all 540 product URLs ships verbatim. */}
      <meta property="og:type" content="product" />
      {/* Product (+Offer only when priced), BreadcrumbList and ItemPage in one graph. */}
      <JsonLd
        data={jsonld.graph([
          jsonld.product(
            product,
            {
              path,
              // the spec: AggregateRating only once there are at least three approved reviews.
              rating:
                product.rating !== undefined && product.rating.count >= 3
                  ? { ratingValue: product.rating.avg, reviewCount: product.rating.count }
                  : null,
            },
            ctx,
          ),
          jsonld.breadcrumb(crumbs, path, ctx),
          jsonld.webPage({ path, title: product.displayName, type: "ItemPage" }, ctx),
        ])}
      />

      {/* UI v4.1 - the stage: breadcrumb, gallery and the buy box on a soft band, so the page opens on
          a composed first screen instead of a bare column. */}
      <section className="pdp-stage">
        <div className="wrap pt-4">
          <Breadcrumbs crumbs={crumbs} />
        </div>
        <div className="wrap pdp-top grid items-start gap-8 lg:grid-cols-[minmax(0,1.12fr)_minmax(400px,0.88fr)] lg:gap-14">
          {/* The plate carries the view-transition name so the tile the shopper tapped becomes this
              gallery rather than cross-fading with the whole page. */}
          <Gallery images={product.gallery} name={product.displayName} productId={product.id} />
          <BuyBox
            gateway={GATEWAY_FOR_CHANNEL[CHANNEL]}
            product={product}
            whatsappHref={`https://wa.me/${settings["store.contact"].whatsapp}`}
            contact={settings["store.contact"]}
            warrantyMonths={product.warrantyMonths ?? null}
            // «موجود در فروشگاه حضوری» is a claim about the shelf, so it is only made for something
            // that is actually in stock (the spec TrustList).
            storeAvailable={product.available}
          />
        </div>
      </section>

      {/* «در یک نگاه»: the first specification rows as tiles. */}
      <PdpHighlights specs={product.specs} />

      {/* The story: description beside a sticky at-a-glance card (specs summary + the dimension figure). */}
      {product.descriptionHtml.trim() !== "" || glance.length > 0 || product.dims !== undefined ? (
        <section className="wrap pdp-section">
          <div className="pdp-story">
            <div>
              {product.descriptionHtml.trim() === "" ? null : (
                <>
                  <h2 className="pdp-h2">{t("product.description")}</h2>
                  <Description html={product.descriptionHtml} />
                </>
              )}
            </div>
            {glance.length === 0 && product.dims === undefined ? null : (
              <aside className="pdp-story__aside">
                <div className="pdp-glance">
                  <p className="pdp-glance__title">{t("product.glance")}</p>
                  {glance.length === 0 ? null : (
                    <dl>
                      {glance.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>
                            <Bdi text={faDigits(row.value)} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {product.dims === undefined ? null : <DimensionDrawing dims={product.dims} />}
                </div>
              </aside>
            )}
          </div>
        </section>
      ) : null}

      {specRows === 0 ? null : (
        <section className="wrap pdp-section">
          <h2 className="pdp-h2">
            {t("product.specs")}
            <small>{t("plp.count", { n: specRows })}</small>
          </h2>
          <SpecTable groups={product.specs} />
        </section>
      )}

      <EditorialBand banner={bands[0] ?? null} />

      <ProductAccordions faqs={faqs} />

      {/* Reviews + Q&A - each behind its settings flag (the spec feature flags). */}
      {flags.reviews || flags.questions ? (
        <div className="wrap pdp-section grid gap-12">
          {flags.reviews ? <Reviews productId={product.id} summary={reviewSummary} initial={reviewPage.items} total={reviewPage.total} /> : null}
          {flags.questions ? <Questions productId={product.id} items={questionPage.items} /> : null}
        </div>
      ) : null}

      <div className="wrap">
        <VariantLinks siblings={product.siblings} currentId={product.id} />
      </div>

      <RelatedRail title="product.related" items={product.related} />
      <RelatedRail title="product.accessories" items={product.accessories} />
      <RecentlyViewed currentId={product.id} />
      <StickyBuyBar
        productId={product.id}
        name={product.displayName}
        price={product.price}
        // A rendition URL, not the bare media key: the bar draws it with a plain <img> (UI v4 fix - the
        // key alone rendered as a broken thumbnail in the sticky bar).
        image={product.gallery[0] === undefined ? null : imgSrc(product.gallery[0], 112)}
        available={product.available}
        onRequest={product.onRequest}
        maxPerOrder={product.maxPerOrder}
      />
    </>
  );
}
