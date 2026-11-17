import type { MetadataRoute } from "next";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };

const V = tokens.brand.admin;

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "پنل نامی‌لوکس",
    short_name: "پنل نامی‌لوکس",
    description: "مدیریت فروشگاه نامی‌لوکس: سفارش‌ها، محصولات، مشتریان و محتوا",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    dir: "rtl",
    lang: "fa",
    orientation: "any",
    background_color: tokens.themes.light.bg,
    theme_color: tokens.themes.light.surface,
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    // Next's Manifest type does not model launch_handler; one window, reused.
    ...({ launch_handler: { client_mode: "navigate-existing" } } as Record<string, unknown>),
    icons: [
      { src: `/icons/${V}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `/icons/${V}/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `/icons/${V}/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: `/icons/${V}/mono-512.png`, sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
    shortcuts: [
      { name: "سفارش‌ها", url: "/orders?source=pwa-shortcut", icons: [{ src: `/icons/${V}/sc-orders.png`, sizes: "96x96" }] },
      { name: "صندوق", url: "/inbox?source=pwa-shortcut" },
      { name: "محصولات", url: "/products?source=pwa-shortcut" },
      { name: "سفارش دستی", url: "/orders/new?source=pwa-shortcut" },
    ],
  };
}
