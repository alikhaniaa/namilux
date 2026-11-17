import { readFile } from "node:fs/promises";
import { extractPath } from "./paths.js";
import { ORIGIN_RE, toPath } from "../transform/slugs.js";

export type LegacyMenuItem = { menu: string; text: string; href: string; depth: number };

/** Every "#"-only link the legacy mega-menu used as a non-navigating heading. */
export const ANCHOR_HREF = "/#";

type RawMenuItem = { text?: unknown; href?: unknown; depth?: unknown };

function menuHref(raw: unknown): string {
  const href = typeof raw === "string" ? raw.trim() : "";
  if (!href) return ANCHOR_HREF;
  const rest = href.replace(ORIGIN_RE, "");
  if (rest === "" || rest === "#" || rest === "/#" || rest === "/" + "#" || rest.startsWith("#")) return ANCHOR_HREF;
  return toPath(href);
}

function menuText(raw: unknown): string {
  return typeof raw === "string"
    ? raw.replace(/\s+/g, " ").replace(/[\p{Cc}\ufeff\ufffd]/gu, "").replace(/\s+/g, " ").trim()
    : "";
}

export async function readLegacyMenus(dir: string): Promise<LegacyMenuItem[]> {
  const parsed: unknown = JSON.parse(await readFile(extractPath(dir, "menusJson"), "utf8"));
  const out: LegacyMenuItem[] = [];
  if (!parsed || typeof parsed !== "object") return out;
  for (const [menu, items] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(items)) continue;
    for (const item of items as RawMenuItem[]) {
      if (!item || typeof item !== "object") continue;
      out.push({
        menu,
        text: menuText(item.text),
        href: menuHref(item.href),
        depth: Number(item.depth) || 1,
      });
    }
  }
  return out;
}

export function auditLegacyMenuTargets(
  items: LegacyMenuItem[],
  served: Set<string>,
  redirects: { from: string }[],
): { href: string; text: string; resolution: "served" | "redirect" | "anchor" | "missing" }[] {
  const redirectFrom = new Set(redirects.map((r) => r.from));
  return items.map((it) => {
    let resolution: "served" | "redirect" | "anchor" | "missing";
    if (it.href === ANCHOR_HREF) resolution = "anchor";
    else if (served.has(it.href)) resolution = "served";
    else if (redirectFrom.has(it.href)) resolution = "redirect";
    else resolution = "missing";
    return { href: it.href, text: it.text, resolution };
  });
}
