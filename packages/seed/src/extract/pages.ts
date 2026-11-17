import { readFile } from "node:fs/promises";
import { extractPath } from "./paths.js";
import { isoFromWpGmt } from "./posts.js";
import { decodeSlug, rootPath } from "../transform/slugs.js";
import { stripTags } from "../transform/sanitize.js";

export type PageTemplate =
  | "default"
  | "contact"
  | "store"
  | "warranty"
  | "returns"
  | "installments"
  | "faq"
  | "privacy"
  | "terms"
  | "about";

export type LegacyPage = {
  id: number;
  slug: string;
  path: string;
  title: string;
  contentHtml: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  template: PageTemplate;
  publish: boolean;
  reason: string;
  /** Set only when PAGE_POLICY overrides the legacy crawl's description (see ABOUT_SEO_DESCRIPTION). */
  seoDescription: string | null;
};

/**
 * The prose of «دربارهٔ ما». It is page DATA - an admin rewrites it from the back office - and it
 * lives here only so that a rebuilt database and the live one say the same thing.
 *
 * DECISION: the legacy WordPress body is NOT kept for this one page. It was an Elementor export
 * whose surviving text claims the shop is «نمایندگی رسمی … دو برند» and then names Smeg and Dyson - 
 * a fact that stopped being true (the catalogue now carries five brands) and that would rot again
 * on the next change. The rewritten prose names no brand at all: the AboutPage template reads them
 * out of the `brands` table, so the list on the page follows the catalogue by itself.
 *
 * VOICE - the owner rejected the first rewrite ("like a paralyzed AI wrote that"), and he was
 * right: it reached for metaphors («خانهٔ جهانی», «به چشم می‌آیند»), for idiom («به‌دردتان
 * نمی‌خورد», «رک می‌گوییم») and for the essayist's turn («ما همه‌چیز نمی‌فروشیم»). This version is
 * what a Tehran shop actually writes: short declarative sentences, ordinary formal Persian, one
 * fact each, no figure of speech anywhere. It states only what the rest of the site already
 * promises - where the shop is, that it sells online, genuine goods with warranty, seven days to
 * return, free delivery, advice before buying.
 */
export const ABOUT_BODY_HTML = `<p>نامی‌لوکس فروشگاه لوازم خانگی لوکس است. فروشگاه حضوری ما در تهران، میدان شوش، پاساژ الماس بلورین قرار دارد و سفارش‌های اینترنتی به سراسر ایران ارسال می‌شود.</p>
<p>ما محصولات چند برند معتبر جهانی را عرضه می‌کنیم. فهرست برندها و تعداد کالاهای هر برند را در ادامهٔ همین صفحه می‌بینید.</p>
<p>همهٔ کالاها اصل و دارای گارانتی است. تا هفت روز پس از تحویل می‌توانید کالا را بازگردانید. ارسال سفارش رایگان است.</p>
<p>برای مشاوره پیش از خرید می‌توانید با ما تماس بگیرید یا در واتس‌اپ پیام بدهید. نشانی و شماره‌های تماس فروشگاه در پایین همین صفحه آمده است.</p>`;

/**
 * The meta description that goes with ABOUT_BODY_HTML. The legacy one is the first 160 characters
 * of the legacy body, so it repeated the same "نمایندگی رسمی دو برند" claim the prose no longer
 * makes - and it broke off mid-sentence, inside a parenthesis.
 */
export const ABOUT_SEO_DESCRIPTION =
  "نامی‌لوکس فروشگاه لوازم خانگی لوکس است؛ فروشگاه حضوری در میدان شوش تهران و ارسال به سراسر ایران. کالای اصل با گارانتی، هفت روز مهلت بازگشت و ارسال رایگان.";

export const PAGE_POLICY: Record<
  string,
  { template: PageTemplate; publish: boolean; reason: string; body?: string; seoDescription?: string }
> = {
  // The one page whose body the seed replaces rather than imports - see ABOUT_BODY_HTML.
  "about-us": {
    template: "about",
    publish: true,
    reason: "content page",
    body: ABOUT_BODY_HTML,
    seoDescription: ABOUT_SEO_DESCRIPTION,
  },
  "contact-us": { template: "contact", publish: true, reason: "content page" },
  "حریم-خصوصی-کاربران": { template: "privacy", publish: true, reason: "legal page required for enamad" },
  "قوانین-و-مقررات-نامی-لوکس": { template: "terms", publish: true, reason: "legal page required for enamad" },
  discount: { template: "default", publish: false, reason: "/discount/ is a dedicated PLP route" },
  shop: { template: "default", publish: false, reason: "/shop/ is a dedicated route" },
  blog: { template: "default", publish: false, reason: "/blog/ is a dedicated route" },
  cart: { template: "default", publish: false, reason: "/cart/ is a dedicated route" },
  compare: { template: "default", publish: false, reason: "/compare/ is a dedicated route" },
  wishlist: { template: "default", publish: false, reason: "/wishlist/ served 200 noindex by the app" },
  billing: { template: "default", publish: false, reason: "/billing/ is the checkout route" },
  "my-account": { template: "default", publish: false, reason: "/my-account/* → /account/* redirects" },
  "namilux-home-new": { template: "default", publish: false, reason: "legacy Elementor home variant" },
  "home-base-rtl": { template: "default", publish: false, reason: "legacy Elementor home variant" },
  تست: { template: "default", publish: false, reason: "staging test page; /تست/ → / redirect" },
};

export const PUBLISHED_PAGE_SLUGS: readonly string[] = Object.entries(PAGE_POLICY)
  .filter(([, p]) => p.publish)
  .map(([slug]) => slug);

/** Applied to a slug that PAGE_POLICY does not know: kept, never published. */
export const UNKNOWN_PAGE_POLICY: {
  template: PageTemplate;
  publish: boolean;
  reason: string;
  body?: string;
  seoDescription?: string;
} = {
  template: "default",
  publish: false,
  reason: "unknown legacy page",
};

type RawWpPage = {
  id?: unknown;
  slug?: unknown;
  status?: unknown;
  date?: unknown;
  date_gmt?: unknown;
  modified?: unknown;
  modified_gmt?: unknown;
  title?: { rendered?: unknown } | null;
  content?: { rendered?: unknown } | null;
};

function rendered(v: { rendered?: unknown } | null | undefined): string {
  return typeof v?.rendered === "string" ? v.rendered : "";
}

export async function readLegacyPages(dir: string): Promise<{ pages: LegacyPage[]; warnings: string[] }> {
  const parsed: unknown = JSON.parse(await readFile(extractPath(dir, "pagesJson"), "utf8"));
  const raw = (parsed as { pages?: unknown } | null)?.pages;
  const warnings: string[] = [];
  const pages: LegacyPage[] = [];
  if (!Array.isArray(raw)) return { pages, warnings: ["pages.json has no `pages` array"] };

  for (const p of raw as RawWpPage[]) {
    if (!p || typeof p !== "object") continue;
    const id = Number(p.id);
    if (!Number.isFinite(id)) {
      warnings.push("page without a numeric id skipped");
      continue;
    }
    // PAGE_POLICY is keyed by the DECODED slug («حریم-خصوصی-کاربران», not its percent form).
    const slug = decodeSlug(typeof p.slug === "string" ? p.slug : "");
    const policy = PAGE_POLICY[slug];
    if (!policy) warnings.push(`page ${id} "${slug}" is not in PAGE_POLICY — archived as unknown legacy page`);
    const effective = policy ?? UNKNOWN_PAGE_POLICY;
    // A policy `body` replaces the legacy export outright; the warning below then judges the
    // body that will actually be stored, not the one that was thrown away.
    const contentHtml = effective.body ?? rendered(p.content);
    if (effective.publish && !contentHtml.trim()) {
      warnings.push(`page ${id} "${slug}" is published by policy but has an empty body`);
    }
    pages.push({
      id,
      slug,
      path: rootPath(slug),
      title: stripTags(rendered(p.title)),
      contentHtml,
      publishedAt: isoFromWpGmt(typeof p.date_gmt === "string" ? p.date_gmt : null) ?? isoFromWpGmt(typeof p.date === "string" ? p.date : null),
      modifiedAt:
        isoFromWpGmt(typeof p.modified_gmt === "string" ? p.modified_gmt : null) ??
        isoFromWpGmt(typeof p.modified === "string" ? p.modified : null),
      template: effective.template,
      publish: effective.publish,
      reason: effective.reason,
      seoDescription: effective.seoDescription ?? null,
    });
  }

  return { pages, warnings };
}
