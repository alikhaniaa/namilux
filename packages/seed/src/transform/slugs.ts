export const ORIGIN_RE = /^https?:\/\/(www\.)?namilux\.ir/i;

/** A last segment that looks like a file (".kml", ".xml", ".jpg") never gets a trailing slash. */
const FILE_LIKE_RE = /\.[a-z0-9]{2,5}$/i;

export function decodeSlug(encoded: string): string {
  const s = (encoded ?? "").trim();
  try {
    return decodeURIComponent(s);
  } catch {
    // Truncated / invalid escape ("%E0%A4%A") - the legacy value is kept verbatim, never thrown on.
    return s;
  }
}

export function toPath(urlOrPath: string): string {
  let p = (urlOrPath ?? "").trim();
  p = p.replace(ORIGIN_RE, "");
  // DECISION: query/hash are stripped BEFORE decoding (the header lists decoding first). Stripping
  // first is the safer reading: a slug carrying a percent-encoded "?" or "#" keeps its bytes instead
  // of being silently truncated, which would split one URL of the 752-URL contract into two.
  const hash = p.indexOf("#");
  if (hash >= 0) p = p.slice(0, hash);
  const query = p.indexOf("?");
  if (query >= 0) p = p.slice(0, query);
  if (!p.startsWith("/")) p = `/${p}`;
  p = decodeSlug(p);
  if (!p.startsWith("/")) p = `/${p}`;
  if (!p.endsWith("/") && !FILE_LIKE_RE.test(p)) p += "/";
  return p;
}

export function slugifyEn(s: string): string {
  return (
    (s ?? "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

export function ensureUniqueSlug(slug: string, taken: Set<string>, prefix?: string): string {
  const claim = (s: string): string => {
    taken.add(s);
    return s;
  };
  if (!taken.has(slug)) return claim(slug);
  if (prefix) {
    const prefixed = `${prefix}-${slug}`;
    if (!taken.has(prefixed)) return claim(prefixed);
  }
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return claim(`${slug}-${n}`);
}

export function productPath(slug: string): string {
  return `/product/${slug}/`;
}

export function brandPath(slug: string): string {
  return `/brand/${slug}/`;
}

export function rootPath(slug: string): string {
  return `/${slug}/`;
}

export function collectionPath(slug: string): string {
  return `/collection/${slug}/`;
}
