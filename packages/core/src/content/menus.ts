import { and, eq, inArray, media as mediaTable, menus as menusTable } from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Actor } from "../types";
import type { MenuKey } from "../constants";

// DECISION (M0 step 3): MENU_KEYS / MenuItemKind are declared once in ../constants and MenuItem /
// MenuInput once in ../types (the spec §content · getMenus).
import { MENU_ITEM_KINDS, MENU_KEYS } from "../constants";
import type { MenuItemKind } from "../constants";
import type { MenuInput, MenuItem } from "../types";
import { appError } from "../errors";
import { faZwnj, stripControl } from "../persian";
import { brandUrl, categoryUrl, collectionUrl, pageUrl } from "../url";
import { audit } from "../audit";
import { tags as cacheTags } from "../cache/tags";

export { MENU_KEYS };
export type { MenuItemKind, MenuItem, MenuInput };

export const MENU_LIMITS: Readonly<Record<MenuKey, { maxDepth: number; maxItems: number }>> = {
  header: { maxDepth: 2, maxItems: 12 },
  drawer: { maxDepth: 3, maxItems: 40 },
  footer_shop: { maxDepth: 1, maxItems: 12 },
  footer_help: { maxDepth: 1, maxItems: 12 },
  tabbar: { maxDepth: 1, maxItems: 4 },
};

/**
 * The stored jsonb node (the spec `menus.items_json`): the canonical `MenuItem` of ../types plus the
 * admin's media pick. `imageMediaId` is deliberately absent from `MenuItem` - the storefront gets a
 * resolved `ImageRef` from catalog/nav.ts, never a raw id - but the write side must round-trip it.
 * DECISION: kept internal (not exported) so the package surface stays exactly the header's contract;
 * `MenuItem` is assignable to it (the extra key is optional), so no cast is ever needed.
 */
type StoredMenuItem = MenuItem & { imageMediaId?: string };

const LABEL_MAX = 40;
const BADGE_MAX = 12;
const HREF_MAX = 512;
const REF_MAX = 200;

/**
 * DECISION: every Latin digit in a label is rejected, not only the ones outside a Latin run. The
 * header spells "Persian digits only" and its EDGE CASE («کالای 2» → VALIDATION) needs no guard; a
 * nav label is «فروشگاه» / «اسمگ», never a model designator, so the simpler rule loses nothing and
 * cannot drift from `faDigits(…, guard)`.
 */
const LATIN_DIGIT_RE = /[0-9]/;

/** the spec - no exclamation marks in UI copy (ASCII and full-width). */
const EXCLAMATION_RE = /[!！]/;

// eslint-disable-next-line no-control-regex -- the guard exists to reject exactly these: a raw CR/LF in a stored href would split a `Location:` header
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/;

const WHITESPACE_RE = /\s/;

const isMenuKey = (key: string): key is MenuKey => (MENU_KEYS as readonly string[]).includes(key);

const isMenuItemKind = (kind: unknown): kind is MenuItemKind =>
  typeof kind === "string" && (MENU_ITEM_KINDS as readonly string[]).includes(kind);

const invalid = (field: string, reason: string, extra?: Record<string, unknown>): never => {
  throw appError("VALIDATION", { details: { field, reason, ...extra } });
};

export function isSafeHref(href: string): boolean {
  if (typeof href !== "string") return false;
  if (href === "" || href.length > HREF_MAX) return false;
  // A control character, whitespace, a backslash (path confusion) or ".." never appears in a href
  // this system mints, and each one is a known escape from the intended origin/path.
  if (CONTROL_CHARS_RE.test(href) || WHITESPACE_RE.test(href) || href.includes("\\")) return false;
  if (href.includes("..")) return false;
  // DECISION: the scheme must be lowercase "https://" verbatim (as validation/common.zHref reads it)
  // and the authority must be non-empty - "https:///evil" and "https://" itself are rejected. Every
  // other scheme (javascript:, data:, http:, tel:) and protocol-relative "//" falls through to false.
  if (href.startsWith("https://")) return href.length > "https://".length && href[8] !== "/";
  return href.startsWith("/") && !href.startsWith("//");
}

/** stripControl + trim + faZwnj, then the spec copy rules. */
function normalizeLabel(raw: unknown, path: string): string {
  if (typeof raw !== "string") return invalid(`${path}.label`, "required");
  const label = faZwnj(stripControl(raw).trim());
  if (label === "") return invalid(`${path}.label`, "required");
  if (label.length > LABEL_MAX) return invalid(`${path}.label`, "too_long", { max: LABEL_MAX });
  if (LATIN_DIGIT_RE.test(label)) return invalid(`${path}.label`, "latin_digit");
  if (EXCLAMATION_RE.test(label)) return invalid(`${path}.label`, "exclamation");
  return label;
}

function normalizeBadge(raw: unknown, path: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return invalid(`${path}.badge`, "invalid");
  const badge = faZwnj(stripControl(raw).trim());
  if (badge === "") return undefined;
  if (badge.length > BADGE_MAX) return invalid(`${path}.badge`, "too_long", { max: BADGE_MAX });
  if (EXCLAMATION_RE.test(badge)) return invalid(`${path}.badge`, "exclamation");
  return badge;
}

/**
 * DECISION: `toLowerCase()` is applied to every ref, not only to the Latin brand/collection slugs - 
 * Persian and Arabic letters have no case, so a category path or a page slug is unchanged, and one
 * call cannot drift from a hand-rolled "is this segment Latin" classifier (content/redirects.ts
 * normalizePath makes the same choice). This is what turns ref "SMEG" into "/brand/smeg/".
 */
function normalizeRef(raw: unknown, path: string): string {
  if (typeof raw !== "string") return invalid(`${path}.ref`, "required");
  const ref = stripControl(raw).trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (ref === "") return invalid(`${path}.ref`, "required");
  if (ref.length > REF_MAX) return invalid(`${path}.ref`, "too_long", { max: REF_MAX });
  if (WHITESPACE_RE.test(ref)) return invalid(`${path}.ref`, "invalid");
  return ref;
}

/** rules: the stored href of a non-url kind is a cache - it is recomputed here from `ref`. */
function hrefForRef(kind: Exclude<MenuItemKind, "url">, ref: string, path: string): string {
  try {
    switch (kind) {
      case "brand":
        return brandUrl(ref);
      case "collection":
        return collectionUrl(ref);
      case "category":
        return categoryUrl(ref);
      case "page":
        return pageUrl(ref);
    }
  } catch {
    // the url module throws RangeError on an empty/unusable slug - a bad request, not a bug
    return invalid(`${path}.ref`, "invalid", { kind });
  }
}

/**
 * The inverse of `hrefForRef` for the four non-url kinds: `/brand/smeg/` → `smeg`. Returns null when
 * the path is not the shape that kind's url builder produces, so nothing is invented.
 */
const REF_PREFIX: Record<Exclude<MenuItemKind, "url">, string> = {
  brand: "/brand/",
  collection: "/collection/",
  category: "/category/",
  page: "/",
};
function refFromHref(kind: Exclude<MenuItemKind, "url">, href: string): string | null {
  const prefix = REF_PREFIX[kind];
  if (!href.startsWith(prefix)) return null;
  const ref = href.slice(prefix.length).replace(/\/+$/, "");
  return ref === "" || ref.includes("/") ? (kind === "category" && ref !== "" ? ref : null) : ref;
}

function normalizeImageMediaId(raw: unknown, path: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return invalid(`${path}.imageMediaId`, "invalid");
  const id = raw.trim();
  return id === "" ? undefined : id;
}

function validateNode(
  node: unknown,
  key: MenuKey,
  depth: number,
  path: string,
  counter: { n: number },
): StoredMenuItem {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return invalid(path, "invalid");
  }
  const limits = MENU_LIMITS[key];
  counter.n += 1;
  if (counter.n > limits.maxItems) {
    return invalid("items", "too_many", { key, max: limits.maxItems });
  }

  const raw = node as Partial<StoredMenuItem> & { children?: unknown };
  if (!isMenuItemKind(raw.kind)) return invalid(`${path}.kind`, "invalid");
  const kind = raw.kind;
  // rules: the tab bar is four links, one level, url kinds only.
  if (key === "tabbar" && kind !== "url") return invalid(`${path}.kind`, "tabbar_url_only");

  const label = normalizeLabel(raw.label, path);

  let href: string;
  let ref: string | undefined;
  if (kind === "url") {
    if (typeof raw.href !== "string") return invalid(`${path}.href`, "required");
    href = stripControl(raw.href).trim();
    if (!isSafeHref(href)) return invalid(`${path}.href`, "unsafe_href");
  } else {
    ref = normalizeRef(raw.ref, path);
    // A category ref is the `categories.path` value, which never carries the route prefix. The url
    // module tolerates "/category/…" on input, so the stored ref is trimmed to match the column - 
    // catalog/nav.ts looks the item up by that exact path.
    if (kind === "category" && ref.startsWith("category/")) ref = ref.slice("category/".length);
    if (ref === "") return invalid(`${path}.ref`, "required");
    href = hrefForRef(kind, ref, path);
  }

  const item: StoredMenuItem = { label, href, kind };
  if (ref !== undefined) item.ref = ref;
  const badge = normalizeBadge(raw.badge, path);
  if (badge !== undefined) item.badge = badge;
  const imageMediaId = normalizeImageMediaId(raw.imageMediaId, path);
  if (imageMediaId !== undefined) item.imageMediaId = imageMediaId;

  const children = raw.children;
  if (children !== undefined && children !== null) {
    if (!Array.isArray(children)) return invalid(`${path}.children`, "invalid");
    if (children.length > 0) {
      if (depth >= limits.maxDepth) {
        return invalid(`${path}.children`, "too_deep", { key, maxDepth: limits.maxDepth });
      }
      item.children = children.map((child, i) =>
        validateNode(child, key, depth + 1, `${path}.children.${i}`, counter),
      );
    }
  }

  return item;
}

export function validateMenuItems(key: MenuKey, items: MenuItem[]): MenuItem[] {
  if (!isMenuKey(key)) return invalid("key", "invalid");
  if (!Array.isArray(items)) return invalid("items", "invalid");

  // rules / EDGE CASE: the tab bar is EXACTLY four items - three or five is a VALIDATION.
  if (key === "tabbar" && items.length !== MENU_LIMITS.tabbar.maxItems) {
    return invalid("items", "tabbar_exactly_four", { given: items.length });
  }

  // DECISION: `maxItems` counts every node of the tree, not the items of one level. The drawer's
  // 40 with depth 3 and the tab bar's "exactly 4" only make sense as totals, and a total is both
  // the stricter reading (a bounded jsonb payload) and the simpler one to reason about.
  const counter = { n: 0 };
  return items.map((item, i) => validateNode(item, key, 1, `items.${i}`, counter));
}

// ---------------------------------------------------------------- read side

const emptyMenus = (): Record<MenuKey, MenuItem[]> => ({
  header: [],
  drawer: [],
  footer_shop: [],
  footer_help: [],
  tabbar: [],
});

/**
 * `items_json` is jsonb: nothing guarantees its shape (a legacy import, a hand-edited row, a schema
 * drift). DECISION: the read side never throws - it drops what it cannot understand, so one bad
 * node can never take the whole shell down, and it re-checks href hygiene (defence in depth: an
 * unsafe href that reached the column through a path other than setMenu is dropped here too).
 * The stored href of a non-url kind is passed through untouched; catalog/nav.ts re-resolves it.
 */
function readNode(node: unknown, key: MenuKey, depth: number, counter: { n: number }): StoredMenuItem | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
  const limits = MENU_LIMITS[key];
  if (counter.n >= limits.maxItems) return null;

  const raw = node as Partial<StoredMenuItem> & { children?: unknown };
  if (!isMenuItemKind(raw.kind)) return null;
  if (typeof raw.label !== "string" || raw.label.trim() === "") return null;
  if (typeof raw.href !== "string") return null;
  const href = raw.href.trim();
  if (raw.kind === "url" && !isSafeHref(href)) return null;

  counter.n += 1;
  const item: StoredMenuItem = { label: raw.label.trim(), href, kind: raw.kind };
  if (typeof raw.ref === "string" && raw.ref.trim() !== "") item.ref = raw.ref.trim();
  // The seed and the legacy import wrote non-url items with a resolved `href` and NO `ref`, but the
  // write side treats `ref` as the authoritative handle and refuses an item without one - so the
  // admin's menu editor loaded such a row, posted it straight back and got «items.N.ref required»,
  // which made every seeded menu unsaveable. Recovering the ref from the href it was built from
  // repairs those rows on read, and re-saving the menu then persists it.
  else if (raw.kind !== "url") {
    const recovered = refFromHref(raw.kind, href);
    if (recovered !== null) item.ref = recovered;
  }
  if (typeof raw.badge === "string" && raw.badge.trim() !== "") item.badge = raw.badge.trim();
  if (typeof raw.imageMediaId === "string" && raw.imageMediaId.trim() !== "") {
    item.imageMediaId = raw.imageMediaId.trim();
  }

  if (Array.isArray(raw.children) && depth < limits.maxDepth) {
    const children: StoredMenuItem[] = [];
    for (const child of raw.children) {
      const resolved = readNode(child, key, depth + 1, counter);
      if (resolved !== null) children.push(resolved);
    }
    if (children.length > 0) item.children = children;
  }

  return item;
}

export async function getMenus(db: Db): Promise<Record<MenuKey, MenuItem[]>> {
  const rows = await db.select({ key: menusTable.key, itemsJson: menusTable.itemsJson }).from(menusTable);
  const out = emptyMenus();
  for (const row of rows) {
    if (!isMenuKey(row.key)) continue;
    const stored: unknown = row.itemsJson;
    if (!Array.isArray(stored)) continue;
    const counter = { n: 0 };
    const items: StoredMenuItem[] = [];
    for (const node of stored) {
      const item = readNode(node, row.key, 1, counter);
      if (item !== null) items.push(item);
    }
    out[row.key] = items;
  }
  // EDGE CASE: a key with no row (the seed authors none) stays [] - the shell falls back to its own
  // defaults (the spec tab bar) instead of rendering a broken slot.
  return out;
}

// ---------------------------------------------------------------- write side

function collectMediaIds(items: readonly StoredMenuItem[], into: Set<string>): void {
  for (const item of items) {
    if (item.imageMediaId !== undefined) into.add(item.imageMediaId);
    if (item.children !== undefined) collectMediaIds(item.children, into);
  }
}

export async function setMenu(
  db: Db,
  key: MenuKey,
  items: MenuItem[],
  actor: Actor,
): Promise<{ tags: string[] }> {
  const normalized: StoredMenuItem[] = validateMenuItems(key, items);

  // rules: `imageMediaId` must reference an IMAGE media row - a video/file id would render nothing.
  const mediaIds = new Set<string>();
  collectMediaIds(normalized, mediaIds);
  if (mediaIds.size > 0) {
    const found = await db
      .select({ id: mediaTable.id })
      .from(mediaTable)
      .where(and(inArray(mediaTable.id, [...mediaIds]), eq(mediaTable.kind, "image")));
    const known = new Set(found.map((row) => row.id));
    for (const id of mediaIds) {
      if (!known.has(id)) invalid("items.imageMediaId", "unknown_media", { id });
    }
  }

  const existing = (
    await db
      .select({ id: menusTable.id, itemsJson: menusTable.itemsJson })
      .from(menusTable)
      .where(eq(menusTable.key, key))
      .limit(1)
  )[0];

  // DECISION: the header says "one UPDATE"; the seed authors no menus row (the spec is a plan, not a
  // fixture), so the first save of a key must INSERT rather than fail - the write stays one
  // statement and the whole tree is still replaced atomically.
  if (existing === undefined) {
    await db.insert(menusTable).values({ key, itemsJson: normalized });
  } else {
    await db.update(menusTable).set({ itemsJson: normalized }).where(eq(menusTable.id, existing.id));
  }

  await audit.log(db, actor, "content.menu.update", "menu", key, existing?.itemsJson, normalized);

  // rules: "returns tags [nav, home]" - verbatim. (cache/invalidation.tagsForMenuChange would add
  // `menu:<key>`; the header fixes this list, so it wins.)
  return { tags: [cacheTags.nav, cacheTags.home] };
}
