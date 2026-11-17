/**
 * The trust seals - eNamad («نماد اعتماد الکترونیکی») and Samandehi («ساماندهی») - from whatever the
 * owner pasted into the admin setting.
 *
 * THE DEFECT THIS EXISTS FOR. Both badges were built from ONE string: `?id=<value>`, duplicated in
 * `shell/Footer.tsx` and `(site)/billing/page.tsx`. eNamad's embed carries TWO values - the numeric
 * `id` and an alphanumeric `Code` - and its server answers a request missing either with the "not
 * registered" mark, so the badge could never draw. The real embed is
 *
 *   <a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=<id>&Code=<code>'>
 *     <img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=<id>&Code=<code>'
 *          alt='' style='cursor:pointer' code='<code>' />
 *   </a>
 *
 * and Samandehi's is the same shape with `p` in place of `Code`, a `Verify.aspx` link and the link
 * hidden inside an `onclick="window.open(…)"`.
 *
 * `seals.enamad_code` is a 4000-character free-text setting, which is what an owner given a snippet
 * to copy will paste into it. So the parsing happens ONCE, here, and accepts either form: the whole
 * pasted `<a …><img …></a>` (or `<img onclick=…>`) snippet, an `id=…&Code=…` query, or the two
 * values on their own. `id` is digits and the code is alphanumerics - nothing else is read out of
 * the setting, so no part of it can reach the markup as anything but those two tokens.
 *
 * The values themselves are never in this repository: they are per-domain and the owner sets them
 * on the box.
 */

/** The two seal hosts. `apps/web/src/security/headers.ts` allows exactly these in `img-src`. */
export const SEAL_HOSTS = {
  enamad: "https://trustseal.enamad.ir",
  samandehi: "https://logo.samandehi.ir",
} as const;

export type SealKind = keyof typeof SEAL_HOSTS;

export type SealEmbed = {
  /** The verification page the badge links to. */
  href: string;
  /** The badge image on the seal's own host. */
  img: string;
  /**
   * The `code` attribute eNamad's own embed puts on the `<img>`; `null` for Samandehi, whose
   * snippet carries no such attribute. Rendered verbatim, never used to build a URL.
   */
  code: string | null;
};

/** A pasted snippet is HTML, so its query separators arrive escaped. */
const AMP = /&amp;|&#0*38;/giu;
/**
 * `id=` preceded by a query/attribute boundary, so the tail of `productid=` or `sessionid=` can
 * never be read as the seal's id. The digits must follow the `=` immediately, which is also what
 * makes Samandehi's own `id='<random letters>'` HTML attribute fall through to the URL's `id=`.
 */
const ID_PARAM = /(?:^|[?&\s;'"(,])id=(\d{1,12})/iu;
const ENAMAD_CODE_PARAM = /(?:^|[?&\s;'"(,])code=([a-z0-9]{1,64})/iu;
const SAMANDEHI_P_PARAM = /(?:^|[?&\s;'"(,])p=([a-z0-9]{1,64})/iu;

const DIGITS = /^\d{1,12}$/u;
const TOKEN = /^[a-z0-9]{4,64}$/iu;
const HAS_LETTER = /[a-z]/iu;
/** Twice the setting's own ceiling: anything longer is not a snippet and is not worth scanning. */
const MAX_INPUT = 8000;

/** `<id>` and `<code>` from a value with no `key=` in it at all - the two tokens, in that order. */
function bareTokens(text: string): { id: string; code: string | null } | null {
  const parts = text.split(/[^a-z0-9]+/iu).filter((p) => p !== "");
  const at = parts.findIndex((p) => DIGITS.test(p));
  const id = at === -1 ? undefined : parts[at];
  if (id === undefined) return null;
  const code = parts.slice(at + 1).find((p) => TOKEN.test(p) && HAS_LETTER.test(p)) ?? null;
  return { id, code };
}

function tokensOf(raw: string, second: RegExp): { id: string; code: string | null } | null {
  const text = raw.trim().replace(AMP, "&");
  if (text === "" || text.length > MAX_INPUT) return null;
  const id = ID_PARAM.exec(text)?.[1];
  if (id !== undefined) return { id, code: second.exec(text)?.[1] ?? null };
  // No `id=` anywhere: the owner pasted the two values rather than the snippet. A value that is
  // markup is never read this way - a tag full of words would otherwise offer up any digits in it.
  return text.includes("<") ? null : bareTokens(text);
}

/** `?a=1` + an optional second parameter, both already restricted to `[A-Za-z0-9]` by the regexes. */
function query(id: string, name: string, code: string | null): string {
  const tail = code === null ? "" : `&${name}=${encodeURIComponent(code)}`;
  return `?id=${encodeURIComponent(id)}${tail}`;
}

/**
 * The eNamad badge. `Code` is dropped rather than guessed when the setting holds an id alone - the
 * badge will show "not registered" until the owner pastes the whole snippet, which is a visible,
 * fixable state, and inventing a code would not make it draw either.
 */
export function enamadSeal(raw: string): SealEmbed | null {
  const parsed = tokensOf(raw, ENAMAD_CODE_PARAM);
  if (parsed === null) return null;
  const q = query(parsed.id, "Code", parsed.code);
  return { href: `${SEAL_HOSTS.enamad}/${q}`, img: `${SEAL_HOSTS.enamad}/logo.aspx${q}`, code: parsed.code };
}

/** The Samandehi badge: the same two values under `p`, and a `Verify.aspx` link rather than `/`. */
export function samandehiSeal(raw: string): SealEmbed | null {
  const parsed = tokensOf(raw, SAMANDEHI_P_PARAM);
  if (parsed === null) return null;
  const q = query(parsed.id, "p", parsed.code);
  return { href: `${SEAL_HOSTS.samandehi}/Verify.aspx${q}`, img: `${SEAL_HOSTS.samandehi}/logo.aspx${q}`, code: null };
}

/** One entry point for a caller that already holds the kind as data. */
export function parseSeal(kind: SealKind, raw: string): SealEmbed | null {
  return kind === "enamad" ? enamadSeal(raw) : samandehiSeal(raw);
}
