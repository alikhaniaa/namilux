import type { MetadataRoute } from "next";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
// the spec colours come from tokens.json (its `manifest` block exists for exactly this).
const { theme_color: THEME, background_color: BACKGROUND } = tokens.manifest;
// The badge folder. tokens.json `brand` is written by the icon build itself, so this can only
// ever name a folder that exists - see the note there.
const ICONS = `/icons/${tokens.brand.icons}`;
export default function manifest(): MetadataRoute.Manifest {
    return {
        id: "/",
        name: "نامی‌لوکس",
        short_name: "نامی‌لوکس",
        description: "فروشگاه لوازم خانگی لوکس، اسمگ، دایسون، سیج، نینجا",
        start_url: "/?source=pwa",
        scope: "/",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        dir: "rtl",
        lang: "fa",
        orientation: "portrait",
        background_color: BACKGROUND,
        theme_color: THEME,
        categories: ["shopping", "lifestyle"],
        prefer_related_applications: false,
        // Next's Manifest type does not model launch_handler yet; the spec requires it.
        ...({ launch_handler: { client_mode: "navigate-existing" } } as Record<string, unknown>),
        icons: [
            { src: `${ICONS}/icon-192.png`, sizes: "192x192", type: "image/png" },
            { src: `${ICONS}/icon-512.png`, sizes: "512x512", type: "image/png" },
            { src: `${ICONS}/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: `${ICONS}/mono-512.png`, sizes: "512x512", type: "image/png", purpose: "monochrome" },
        ],
        screenshots: [
            { src: "/screenshots/home-390.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "خانه" },
            ...([{ src: "/screenshots/pdp-390.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "صفحهٔ محصول" } as const]),
            { src: "/screenshots/home-1280.png", sizes: "1280x800", type: "image/png", form_factor: "wide", label: "خانه" },
        ],
        shortcuts: [
            { name: "فروشگاه", url: "/shop/?source=pwa-shortcut", icons: [{ src: `${ICONS}/sc-shop.png`, sizes: "96x96" }] },
            { name: "پیشنهادهای ویژه", url: "/discount/?source=pwa-shortcut" },
            { name: "سبد خرید", url: "/cart/?source=pwa-shortcut" },
            { name: "سفارش‌های من", url: "/account/orders/?source=pwa-shortcut" },
        ],
    };
}
