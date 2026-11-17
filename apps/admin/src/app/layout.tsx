import "../styles/globals.css";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SwRegister } from "@/components/shell/SwRegister";
import { fa } from "@/i18n/fa";

const ICONS = `/icons/${tokens.brand.admin}`;

export const metadata: Metadata = {
  title: fa["app.name"],
  applicationName: fa["app.name"],
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: fa["app.name"], statusBarStyle: "default" },
  icons: {
    icon: [
      { url: `/favicon.ico?v=${tokens.brand.icons}`, type: "image/x-icon" },
      { url: `${ICONS}/favicon-32.png`, sizes: "32x32", type: "image/png" },
      { url: `${ICONS}/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: `${ICONS}/apple-touch-icon.png`, sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: tokens.themes.light.surface,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Carries no data; allowed by the per-request nonce the proxy issues. Stamped before
// first paint so an installed panel never flashes an un-padded topbar under the status bar.
const STANDALONE_SCRIPT =
  "try{if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)" +
  "document.documentElement.setAttribute('data-standalone','1')}catch(e){}";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="fa-IR" dir="rtl" suppressHydrationWarning>
      <body>
        <script nonce={nonce}>{STANDALONE_SCRIPT}</script>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
