import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
import { renderToStaticMarkup } from "react-dom/server";
import manifest from "../../../app/manifest";
import splash from "../../../../public/splash/index.json" with { type: "json" };
import { Wordmark } from "../Wordmark";

/** The badge (tab, installed app, splash, social card). The icon build moves this - never a hand edit. */
const ICONS = `/icons/${tokens.brand.icons}`;
/** The lettering the header, the footer and the panel keep. app/layout.tsx preloads it as the LCP. */
const WORDMARK = `/brand/${tokens.brand.wordmark}/logo-name-alpha.webp`;

const PUBLIC = fileURLToPath(new URL("../../../../public/", import.meta.url));
const onDisk = (url: string): boolean => existsSync(PUBLIC + url.replace(/^\//, "").split("?")[0]);
/**
 * app/layout.tsx cannot be imported here: it reaches `@/env`, which validates the whole environment
 * at import time and exits the worker. Its asset URLs are read as text instead, which is also the
 * stronger assertion - the point is that it builds them from the token and hard-codes no folder.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const layoutSource = read("../../../app/layout.tsx");
const manifestSource = read("../../../app/manifest.ts");
const coachSource = read("../../pwa/InstallCoach.tsx");

describe("owner branding", () => {
  it("retains an accessible home link when the supplied wordmark is displayed", () => {
    const html = renderToStaticMarkup(<Wordmark />);
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="نامی‌لوکس"');
    expect(html).toContain("brand-logo");
    expect(html).toContain("sr-only");
  });

  it("uses fresh first-party symbol URLs for all required PWA icon variants", () => {
    const data = manifest();
    expect(data.icons?.map((i) => i.sizes)).toEqual(["192x192", "512x512", "512x512", "512x512"]);
    expect(data.icons?.every((i) => i.src.startsWith(`${ICONS}/`))).toBe(true);
    expect(data.icons?.find((i) => i.purpose === "maskable")).toBeDefined();
    expect(data.icons?.find((i) => i.purpose === "monochrome")).toBeDefined();
    expect(data.shortcuts?.[0]?.icons?.[0]?.src).toBe(`${ICONS}/sc-shop.png`);
    expect(data.id).toBe("/");
    expect(data.start_url).toBe("/?source=pwa");
  });

  /**
   * `next.config.ts` serves `/icons/*` and `/splash/*` `immutable`, and `proxy.ts` now answers a hard
   * 404 for a path it does not recognise. So a reference that outruns its file is not a soft miss - 
   * it is a permanently cached 404 on the installed app's own icon.
   */
  it("points every icon, splash and social reference at a file that exists", () => {
    const referenced = [
      ...["favicon-16", "favicon-32", "icon-192", "icon-512", "maskable-512", "mono-512", "apple-touch-icon", "sc-shop"].map(
        (f) => `${ICONS}/${f}.png`,
      ),
      // both copies of every startup image: the versioned one iOS is given, and the bare name kept alive
      ...splash.flatMap((s) => [s.href, s.href.replace("/splash/", `/splash/${tokens.brand.icons}/`)]),
      WORDMARK,
      `/icons/${tokens.brand.icons}/icon-192.png`, // the install coach's preview
      ...(manifest().icons ?? []).map((i) => i.src),
      ...(manifest().screenshots ?? []).map((s) => s.src),
      ...(manifest().shortcuts ?? []).flatMap((s) => (s.icons ?? []).map((i) => i.src)),
    ];
    expect(referenced.filter((url) => !onDisk(url))).toEqual([]);
  });

  it("builds every asset URL from the token, never from a folder typed by hand", () => {
    expect(layoutSource).toContain("tokens.brand.icons");
    expect(layoutSource).toContain("tokens.brand.wordmark");
    // A literal folder in TypeScript is what lets a reference and its files drift apart. The CSS
    // wordmark is exempt: a stylesheet cannot read the token, and that URL is pinned by design.
    for (const src of [layoutSource, manifestSource, coachSource]) {
      expect(src.match(/["'`]\/(?:icons|splash|brand)\/(?:brand|admin)-\d{8}/g)).toBeNull();
    }
  });

  it("keeps the badge on the app surfaces and the lettering on the chrome", () => {
    // The header/footer mark is CSS, so the wordmark URL is asserted where it is actually written.
    const css = readFileSync(fileURLToPath(new URL("../../../styles/components.css", import.meta.url)), "utf8");
    expect(css).toContain(WORDMARK);
    expect(css).not.toContain(`/icons/${tokens.brand.icons}`);
  });

  it("still answers the retired brand folders, which outside links may hold", () => {
    for (const url of ["/icons/brand-20260831/icon-512.png", "/splash/brand-20260831/apple-splash-1170x2532.png"]) {
      expect(onDisk(url)).toBe(true);
    }
  });
});
