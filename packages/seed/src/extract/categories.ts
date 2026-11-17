import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { htmlToText } from "@namilux/core";
import { extractPath } from "./paths.js";
import { decodeSlug, toPath } from "../transform/slugs.js";

export type LegacyCategory = {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  fullPath: string;
  path: string;
  dbPath: string;
  productCount: number;
  description: string;
  descriptionHtml: string | null;
  coverUrl: string | null;
  visibleInStore: boolean;
};

/** The category the live site 301s to /brand/smeg/; the importer archives it. */
export const CATEGORY_PATH_REDIRECTED_TO_BRAND = "/category/محصولات-اسمگ/";

const CATEGORY_BASE = "/category/";

type StoreCategory = {
  id?: unknown;
  description?: unknown;
  image?: { src?: unknown } | null;
};

function stripControl(s: string): string {
  // \p{Cc} covers C0/C1 + DEL without writing a literal control char into the source.
  return (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\ufeff\ufffd]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function categoryPathFromUrl(url: string): string {
  return toPath(url);
}

export function dbPathFromPath(path: string): string {
  const p = path.startsWith(CATEGORY_BASE) ? path.slice(CATEGORY_BASE.length) : path.replace(/^\/+/, "");
  return p.replace(/\/+$/, "");
}

async function readStoreCategories(dir: string): Promise<Map<number, StoreCategory>> {
  const out = new Map<number, StoreCategory>();
  const parsed: unknown = JSON.parse(await readFile(extractPath(dir, "taxonomiesStoreJson"), "utf8"));
  const rows = (parsed as { categories?: unknown } | null)?.categories;
  if (!Array.isArray(rows)) return out;
  for (const c of rows as StoreCategory[]) {
    const id = Number(c?.id);
    if (Number.isFinite(id)) out.set(id, c);
  }
  return out;
}

export async function readLegacyCategories(
  dir: string,
): Promise<{ categories: LegacyCategory[]; collisions: { path: string; kept: number; dropped: number }[]; warnings: string[] }> {
  const buf = await readFile(extractPath(dir, "categoriesCsv"));
  const rows: Record<string, string | undefined>[] = parse(buf, { columns: true, bom: true, relax_column_count: true });
  const store = await readStoreCategories(dir);

  const collisions: { path: string; kept: number; dropped: number }[] = [];
  const warnings: string[] = [];
  const seenPath = new Map<string, number>();
  const parsed: LegacyCategory[] = [];

  for (const r of rows) {
    const id = Number(r["id"]);
    const url = (r["url"] ?? "").trim();
    if (!Number.isFinite(id) || !url) {
      warnings.push(`categories.csv row without id/url skipped: ${JSON.stringify(r["name"] ?? "")}`);
      continue;
    }
    const path = categoryPathFromUrl(url);
    const kept = seenPath.get(path);
    if (kept !== undefined) {
      collisions.push({ path, kept, dropped: id });
      continue;
    }
    seenPath.set(path, id);

    const s = store.get(id);
    const descriptionHtml = typeof s?.description === "string" && s.description.trim() ? s.description : null;
    const csvDescription = stripControl(r["description"] ?? "");
    // DECISION: the Store API description is unwrapped with core `htmlToText` (already implemented
    // and tested) rather than a second hand-rolled tag stripper; transform/sanitize owns HTML bodies.
    const description = csvDescription || (descriptionHtml ? stripControl(htmlToText(descriptionHtml)) : "");
    const parentId = Number(r["parent_id"]) || null;

    parsed.push({
      id,
      name: stripControl(r["name"] ?? ""),
      // Slugs and paths are never altered - the spec is a byte-for-byte contract.
      slug: decodeSlug(r["slug"] ?? ""),
      parentId,
      fullPath: stripControl(r["full_path"] ?? ""),
      path,
      dbPath: dbPathFromPath(path),
      productCount: Number(r["product_count"]) || 0,
      description,
      descriptionHtml,
      coverUrl: typeof s?.image?.src === "string" && s.image.src.trim() ? s.image.src : null,
      visibleInStore: s !== undefined,
    });
  }

  // Parents before children (the CSV is not guaranteed to be ordered), each level by id asc.
  const byId = new Map(parsed.map((c) => [c.id, c]));
  const remaining = [...parsed].sort((a, b) => a.id - b.id);
  const emitted = new Set<number>();
  const categories: LegacyCategory[] = [];
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    for (let i = 0; i < remaining.length; ) {
      const c = remaining[i] as LegacyCategory;
      if (c.parentId === null || emitted.has(c.parentId) || !byId.has(c.parentId)) {
        if (c.parentId !== null && !byId.has(c.parentId)) {
          warnings.push(`category ${c.id} references missing parent ${c.parentId} — treated as a root`);
        }
        categories.push(c);
        emitted.add(c.id);
        remaining.splice(i, 1);
        progress = true;
        continue;
      }
      i += 1;
    }
  }
  for (const c of remaining) {
    warnings.push(`category ${c.id} is part of a parent cycle — emitted last`);
    categories.push(c);
  }

  return { categories, collisions, warnings };
}
