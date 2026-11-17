import { jsonld } from "@namilux/core";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import splash from "../../public/splash/index.json" with { type: "json" };
import { STANDALONE_SCRIPT, THEME_SCRIPT } from "@/security/headers";
import { JsonLd } from "@/components/ui/JsonLd";
import { Providers } from "@/components/state/providers";
import { env } from "@/env";
import { t } from "@/i18n";
import { loadSettings } from "@/server/loaders/settings";
import "../styles/globals.css";
/** The header wordmark (components.css `.brand-logo`); preloaded because it is the phone's LCP element. */
const WORDMARK_SRC = `/brand/${tokens.brand.wordmark}/logo-name-alpha.webp`;
/**
 * NOT wired here on purpose. The icon build also renders a branded 1200×630 card to
 * `/brand/<version>/og-1200x630.png`, but this site's og:image is a database setting
 * (`seo.defaultOgKey` → the media store, rendered by the worker's `og.generate`), not a static file.
 * Declaring a second, static default in the root metadata would silently change what every route
 * with no entity behind it shares, and that cannot be verified without a database. The card is
 * generated as an asset for the owner to upload as the `og/site.jpg` default instead.
 */
// the spec - one family, one file, subset, preloaded. The Vazirmatn metric fallback is declared
// in styles/fonts.css; naming it here keeps `font-family` resolution in one place.
const estedad = localFont({
    src: "../../public/fonts/Estedad-VF.woff2",
    variable: "--font-estedad",
    weight: "400 800",
    display: "swap",
    preload: true,
    fallback: ["Vazirmatn Fallback", "Vazirmatn", "Segoe UI", "Tahoma", "sans-serif"],
});
// UI v4 (1 Sep, owner's premium brief): a Latin display serif for the editorial runs only - the
// hero kicker, brand marks, model codes, the marquee. Persian never uses it. Two first-party
// files (regular + italic, latin subset, 43 KB together), OFL - see packages/tokens/fonts.
const instrument = localFont({
    src: [
        { path: "../../public/fonts/InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
        { path: "../../public/fonts/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
    ],
    variable: "--font-instrument",
    display: "swap",
    preload: true,
    fallback: ["Georgia", "Times New Roman", "serif"],
});
export const metadata: Metadata = {
    metadataBase: new URL(env.SITE_ORIGIN),
    title: { default: "نامی لوکس", template: "%s" },
    // The instalment storefront is never indexed (app/robots.ts): the default here is the floor every
    // page inherits, so a route that sets no robots line of its own still ships `noindex, nofollow`.
    ...({}),
    applicationName: "نامی‌لوکس",
    manifest: "/manifest.webmanifest",
    formatDetection: { telephone: false },
    appleWebApp: {
        capable: true,
        title: "نامی‌لوکس",
        statusBarStyle: "black-translucent",
        startupImage: splash.map((s) => ({ url: s.href.replace("/splash/", `/splash/${tokens.brand.icons}/`), media: s.media })),
    },
    icons: {
        icon: [
            { url: `/icons/${tokens.brand.icons}/favicon-16.png`, sizes: "16x16", type: "image/png" },
            { url: `/icons/${tokens.brand.icons}/favicon-32.png`, sizes: "32x32", type: "image/png" },
            { url: `/icons/${tokens.brand.icons}/icon-192.png`, sizes: "192x192", type: "image/png" },
        ],
        apple: [{ url: `/icons/${tokens.brand.icons}/apple-touch-icon.png`, sizes: "180x180" }],
    },
};
export const viewport: Viewport = {
    themeColor: tokens.manifest.theme_color,
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};
export default async function RootLayout({ children }: {
    children: React.ReactNode;
}) {
    const settings = await loadSettings();
    const graph = jsonld.orgSite({
        origin: env.SITE_ORIGIN,
        siteName: settings["store.info"].brandName,
        store: {
            ...settings["store.info"],
            ...settings["store.contact"],
            instagram: settings["store.social"].instagram,
        },
        mediaUrl: (key: string) => `${env.SITE_ORIGIN}/media/${key}`,
    });
    return (<html lang="fa-IR" dir="rtl" data-scroll-behavior="smooth" className={`${estedad.variable} ${instrument.variable}`} suppressHydrationWarning>
      <body>
        {/* Performance trace 3 Sep 2026 (production build, phone, Fast 4G, 4× CPU): the LCP element
            on a phone is the header wordmark, a CSS background discovered only after the stylesheet
            (queued at 825 ms). The hint is rendered here and hoisted into <head> by React; the
            `react-dom` preload() call did not survive the cached prerender of this layout. */}
        <link rel="preload" as="image" href={WORDMARK_SRC} fetchPriority="high"/>
        {/* The two pre-paint scripts. They carry no data and are allow-listed by SHA-256 in both
            CSP variants (security/headers.ts), so the layout never has to read a per-request nonce - 
            which under `cacheComponents` would make every route dynamic. */}
        <script>{THEME_SCRIPT}</script>
        <script>{STANDALONE_SCRIPT}</script>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:border focus:border-line focus:bg-surface focus:px-4 focus:py-2">
          {t("shell.skip")}
        </a>
        {/* application/ld+json is a data block, not an executable script - no nonce needed. */}
        <JsonLd data={graph}/>
        <Providers user={null} coach={settings["pwa.coach"]}>
          {children}
        </Providers>
      </body>
    </html>);
}
