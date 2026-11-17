import { activeFilterCount, plpUrl, pruneFacets, ROUTES, tags } from "@namilux/core/client";
import type { Crumb, ImageRef, PlpState, ProductScope } from "@namilux/core/client";
import { tagCatalog } from "@/lib/cache";
import { ActiveFilters } from "./ActiveFilters";
import { ComingSoonBrand } from "./ComingSoonBrand";
import { FilterRail } from "./FilterRail";
import { Pagination } from "./Pagination";
import { PlpHero } from "./PlpHero";
import type { PlpHeroLink } from "./PlpHero";
import { PlpStory } from "./PlpStory";
import { PlpToolbar } from "./PlpToolbar";
import { ProductGrid } from "./ProductGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import { t } from "@/i18n";
import { loadCollectionCovers, loadPlp } from "@/server/loaders/catalog";
import { loadNav } from "@/server/loaders/nav";
import { loadSettings } from "@/server/loaders/settings";

/** PLP_DEFAULTS.density - the column count the server always renders (F-010 persists 5 client-side). */
const DEFAULT_DENSITY = 3;
/** Shop-by-category pills derived from the scope's collection facet: the most populated first. */
const QUICK_LINKS = 8;

// NOTE for the route files: this body is dynamic (it awaits the listing for the current filters) and
// its toolbar reads `useSearchParams`, so with `cacheComponents: true` (next.config.ts) each route
// renders <PlpPage> inside its own <Suspense> boundary. No boundary is added here: the fallback
// belongs to the page that owns the header/breadcrumb above it.

export async function PlpPage({
  scope,
  state,
  basePath,
  title,
  descriptionHtml,
  chips,
  comingSoon,
  crumbs,
  hero,
  quickLinks,
}: {
  scope: ProductScope;
  state: PlpState;
  basePath: string;
  title: string;
  descriptionHtml?: string | null;
  // DECISION: the contract's `children?: { chips?… }` is spelled as the flat `chips?` the scaffold
  // declares - `children` in React means the rendered subtree, and a prop of that name holding a
  // data bag would read as one at every call site.
  chips?: { href: string; label: string; count: number }[];
  comingSoon?: { brand: string };
  crumbs?: Crumb[];
  /** UI v4.2: what the hero shows beside the title - a Latin mark, an eyebrow, a claim, a photograph. */
  hero?: { kicker?: string; eyebrow?: string; claim?: string | null; image?: ImageRef | null; imageAlt?: string };
  /** UI v4.2: explicit shop-by-category pills (the shop page hands the collection groups). */
  quickLinks?: PlpHeroLink[];
}): Promise<React.ReactNode> {
  "use cache";
  // DECISION (4 Sep 2026, performance review): the listing body is cached as a rendered React tree,
  // keyed by every prop (scope, state, copy). The route above still reads `searchParams`, so with
  // cacheComponents this subtree is the page's one dynamic hole - before, that hole re-ran the
  // loaders' cache lookups AND re-rendered sixty product cards on every request (≈75–150 ms of
  // CPU per listing hit). Now a repeat hit costs the HTML streaming of a ready tree. The tags are
  // the same set the loaders carry: the catalog family and the scope (an edit to one brand or
  // category flushes only its listings), plus settings (density flag) and nav (brand marks).
  tagCatalog(
    [
      ...(scope.kind === "category" && scope.id !== undefined
        ? [tags.category(scope.id)]
        : scope.kind === "brand" && scope.id !== undefined
          ? [tags.brand(scope.id)]
          : scope.kind === "collection" && scope.id !== undefined
            ? [tags.collection(scope.id)]
            : []),
      tags.settings,
      tags.nav,
    ],
    "hours",
  );
  const [result, settings, nav, collectionCovers] = await Promise.all([
    loadPlp({ scope, ...state }),
    loadSettings(),
    loadNav(),
    loadCollectionCovers(),
  ]);
  // The brand facet shows each brand's mark (3 Sep 2026 filter sheet); the shell nav already carries
  // the logos, so the listing borrows them instead of a second query.
  const brandLogos: Record<string, ImageRef> = {};
  for (const b of nav.brands) if (b.image !== null) brandLogos[b.slug] = b.image;
  // Options that match nothing are dropped, but a selected one survives so a stale URL can be undone.
  const pruned = pruneFacets(result.facets, state);
  // A brand page's own brand is not a filter worth offering; the group would hold one chip.
  const facets = scope.kind === "brand" ? { ...pruned, brand: [] } : pruned;
  const filtered = activeFilterCount(state) > 0;
  const empty = result.items.length === 0;
  // EDGE CASE: an empty result still owes the reader somewhere to go (the spec - an EmptyState
  // ALWAYS carries a rail), so the scope is queried once more without the filters.
  // DECISION: the rail is the scope's best-sellers («پرفروش‌ترین‌ها»); `plp.empty.rail`
  // («دسته‌های پرطرفدار») waits for a category rail, which this component has no data for.
  const fallback = empty ? await loadPlp({ scope, sort: "bestselling" }) : null;

  // The category pills of the hero: explicit links first, then a page's children, then - for a
  // brand - the collections its products sit in (every pill is a plpUrl, so it is a shareable,
  // crawlable filtered view of the same listing).
  const links: PlpHeroLink[] =
    quickLinks ??
    chips ??
    (scope.kind === "brand"
      ? [...result.facets.collection]
          .sort((a, b) => b.count - a.count)
          .slice(0, QUICK_LINKS)
          .map((option) => ({
            href: plpUrl(basePath, { collection: [option.value], page: 1 }),
            label: option.label,
            count: option.count,
            current: state.collection?.includes(option.value) === true,
          }))
      : []);

  return (
    <>
      {/* «۱۷۲ کالای آماده» is the honest number for an unfiltered scope; once the reader has
          narrowed it down, the count of what they are looking at is the only truthful one. */}
      <PlpHero
        title={title}
        total={result.total}
        {...(filtered ? {} : { ready: facets.avail.ready })}
        {...(crumbs === undefined ? {} : { crumbs })}
        {...(hero?.kicker === undefined ? {} : { kicker: hero.kicker })}
        {...(hero?.eyebrow === undefined ? {} : { eyebrow: hero.eyebrow })}
        {...(hero?.claim === undefined ? {} : { claim: hero.claim })}
        {...(hero?.image === undefined ? {} : { image: hero.image })}
        {...(hero?.imageAlt === undefined ? {} : { imageAlt: hero.imageAlt })}
        links={links}
        linksLabel={t("plp.shopBy")}
      />

      {comingSoon === undefined ? null : (
        <ComingSoonBrand
          // The page-level prop carries the brand's display name only; the Latin wordmark and the
          // claim belong to the brand route's own header.
          brand={{ name: comingSoon.brand, nameEn: "", claim: null }}
          {...(result.items[0] === undefined
            ? {}
            : { product: { id: result.items[0].id, name: result.items[0].displayName } })}
        />
      )}

      <div className="plp-toolbar">
        <div className="wrap flex py-3">
          <PlpToolbar
            state={state}
            facets={facets}
            basePath={basePath}
            total={result.total}
            brandLogos={brandLogos}
            collectionCovers={collectionCovers}
            densityToggle={settings.flags.densityToggle}
          />
        </div>
      </div>

      {/* ActiveFilters owns `wrap tier-block` itself so an unfiltered listing paints no empty band. */}
      <ActiveFilters state={state} facets={facets} basePath={basePath} />

      <div className="wrap plp-body grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        {/* the spec: the rail is the desktop affordance; below lg the same tree is the sheet. */}
        <aside className="plp-rail hidden lg:block">
          <FilterRail state={state} facets={facets} basePath={basePath} />
        </aside>

        <div className="grid gap-6">
          {empty ? (
            <EmptyState
              title="plp.empty.title"
              body="plp.empty.body"
              primary={{ key: "plp.clearAll", href: plpUrl(basePath, {}) }}
              secondary={{ key: "nav.shop", href: ROUTES.shop }}
              rail={{ title: "cart.empty.rail", items: fallback?.items ?? [] }}
              texture="pampas"
            />
          ) : (
            <ProductGrid items={result.items} density={state.density ?? DEFAULT_DENSITY} />
          )}
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            basePath={basePath}
            state={state}
          />
        </div>
      </div>

      <PlpStory title={title} html={descriptionHtml} />
    </>
  );
}
