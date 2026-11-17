// DECISION: the character class stays `[0-9A-F]` (v1, verified 752/752) rather than the wider
// `[0-9A-Fa-f]`. `encodeURIComponent` only ever emits uppercase hex, so the two are identical on
// every input this function is fed; the narrow class additionally guarantees that an already
// lowercase (or mixed-case) triplet is left byte-for-byte alone.
export const lowerHex = (s: string): string => s.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

export const encSeg = (seg: string): string => lowerHex(encodeURIComponent(seg));

export const encPath = (decodedPath: string): string =>
  decodedPath
    .split("/")
    .map((seg) => (seg ? encSeg(seg) : seg))
    .join("/");

/** decodeURIComponent that never throws: a malformed segment is returned unchanged. */
const decSeg = (seg: string): string => {
  try {
    return decodeURIComponent(seg);
  } catch {
    // DECISION: a malformed percent-sequence is NOT repaired and NOT rejected here - the segment is
    // passed through verbatim so the router simply finds nothing and 404s.
    return seg;
  }
};

export const decPath = (p: string): string =>
  p
    .split("/")
    .map((seg) => (seg ? decSeg(seg) : seg))
    .join("/");

export function isEncodedCanonical(p: string): boolean {
  return encPath(decPath(p)) === p;
}

const QUERY_OR_HASH_RE = /[?#]/;

/**
 * The path part of `p`, i.e. everything before the first "?" or "#".
 * DECISION: exported although it is not in the contract list - `routes.ts` (legacy redirect matchers)
 * needs exactly this splitting, and duplicating it there would put a second URL-surgery rule outside
 * `url/encode.ts`, which the spec forbids.
 */
export const pathOnly = (p: string): string => {
  const cut = p.search(QUERY_OR_HASH_RE);
  return cut === -1 ? p : p.slice(0, cut);
};

export function ensureTrailingSlash(p: string): string {
  const cut = p.search(QUERY_OR_HASH_RE);
  const base = cut === -1 ? p : p.slice(0, cut);
  const rest = cut === -1 ? "" : p.slice(cut);
  const withSlash = base === "" ? "/" : base.endsWith("/") ? base : `${base}/`;
  return `${withSlash}${rest}`;
}

// DECISION: `stripTrailingSlash` is documented as "inverse for comparisons only", so it operates on
// the raw string (no query/hash splitting) - the simplest reading, and the only one the spec gives an
// edge case for ("/" stays "/").
export function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}
