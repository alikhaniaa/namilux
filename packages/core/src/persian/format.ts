export const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const THOUSANDS_SEP = "٬";
export const ELLIPSIS = "…";
export const MINUS = "−";
export const TEHRAN_TZ = "Asia/Tehran";
export const FA_LOCALE = "fa-IR-u-ca-persian-nu-arabext";

export type LatinRun = { text: string; latin: boolean };
export type JalaliStyle = "long" | "short" | "numeric";

// ---------------------------------------------------------------- internals
const ASCII_ZERO = 0x30;
const AR_ZERO = 0x0660;

const DIGIT_RUN_RE = /[0-9٠-٩۰-۹]+/g;
const ASCII_LETTER_RE = /[A-Za-z]/;
const FA_TO_EN_RE = /[۰-۹]/g;
const AR_TO_EN_RE = /[٠-٩]/g;
/** ، ؛ : . , ؟ ! - dropped from the last kept word before the ellipsis. */
const TRAILING_PUNCT_RE = /[،؛؟:.,!]+$/;
const WHITESPACE_SPLIT_RE = /(\s+)/;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const REL_NOW = "همین حالا";
const REL_PAST = "پیش";
const REL_FUTURE = "دیگر";
const UNIT_MINUTE = "دقیقه";
const UNIT_HOUR = "ساعت";
const UNIT_DAY = "روز";
const UNIT_WEEK = "هفته";

/** Persian digits for one run of ASCII / Arabic-Indic digits; anything else is copied through. */
function toFaDigits(run: string): string {
  let out = "";
  for (let i = 0; i < run.length; i++) {
    const c = run.charCodeAt(i);
    if (c >= ASCII_ZERO && c <= ASCII_ZERO + 9) out += FA_DIGITS.charAt(c - ASCII_ZERO);
    else if (c >= AR_ZERO && c <= AR_ZERO + 9) out += FA_DIGITS.charAt(c - AR_ZERO);
    else out += run.charAt(i);
  }
  return out;
}

function parseIso(iso: string): Date | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function isLatinToken(token: string): boolean {
  return ASCII_LETTER_RE.test(token);
}

// ---------------------------------------------------------------- contract
export function faInt(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new RangeError("faInt: expected a finite number");
  }
  const i = Math.trunc(n);
  // DECISION: beyond 2^53 String(n) is exponent notation ("1e+21") which cannot be grouped - 
  // throwing is safer than rendering a mangled price.
  if (!Number.isSafeInteger(i)) throw new RangeError("faInt: expected a safe integer");
  const negative = i < 0;
  const digits = String(Math.abs(i));
  let out = "";
  for (let k = 0; k < digits.length; k++) {
    if (k > 0 && (digits.length - k) % 3 === 0) out += THOUSANDS_SEP;
    out += FA_DIGITS.charAt(digits.charCodeAt(k) - ASCII_ZERO);
  }
  return negative ? MINUS + out : out;
}

export function faDigits(s: string | number, guard = false): string {
  const input = typeof s === "string" ? s : String(s);
  return input.replace(DIGIT_RUN_RE, (run: string, offset: number) => {
    if (guard) {
      const before = offset > 0 ? input.charAt(offset - 1) : "";
      const after = input.charAt(offset + run.length);
      if (isLatinToken(before) || isLatinToken(after)) return run;
    }
    return toFaDigits(run);
  });
}

export function enDigits(s: string): string {
  if (typeof s !== "string") return "";
  return s
    .replace(FA_TO_EN_RE, (d) => String.fromCharCode(ASCII_ZERO + d.charCodeAt(0) - 0x06f0))
    .replace(AR_TO_EN_RE, (d) => String.fromCharCode(ASCII_ZERO + d.charCodeAt(0) - AR_ZERO));
}

export function formatToman(t: number): string {
  return faInt(t);
}

export function formatJalali(iso: string, style: JalaliStyle = "long"): string {
  const d = parseIso(iso);
  if (!d) return "";
  const opts: Intl.DateTimeFormatOptions =
    style === "numeric"
      ? { year: "numeric", month: "2-digit", day: "2-digit" }
      : style === "short"
        ? { day: "numeric", month: "long" }
        : { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Intl.DateTimeFormat(FA_LOCALE, { timeZone: TEHRAN_TZ, ...opts }).format(d);
  } catch {
    // DECISION: a date is never load-bearing in the UI - an ICU build without the Persian
    // calendar degrades to an empty caption instead of breaking the page.
    return "";
  }
}

/**
 * The shop's calendar day (Tehran) an instant falls on, as a sortable key - «2026-10-01». Two
 * instants are "the same day" for the shop when their keys are equal; "" when ICU lacks the zone.
 */
export function tehranDayKey(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TEHRAN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return "";
  }
}

/** The Tehran clock time of an instant in Persian digits - «۱۰:۴۲»; "" for an unreadable date. */
export function formatTehranTime(iso: string): string {
  const d = parseIso(iso);
  if (!d) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TEHRAN_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    return hour === "" || minute === "" ? "" : toFaDigits(`${hour}:${minute}`);
  } catch {
    return "";
  }
}

const RANGE_TO = "تا";
const FRIDAY = "Fri";

/** The Tehran weekday of an instant, as the en-US short name ("Fri"); "" when ICU lacks the zone. */
function tehranWeekday(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: TEHRAN_TZ, weekday: "short" }).format(d);
  } catch {
    return "";
  }
}

/** `days` working days after `from` (Friday skipped); 0 → the same instant. */
function addWorkingDays(from: Date, days: number): Date {
  let at = from;
  let left = days;
  while (left > 0) {
    at = new Date(at.getTime() + DAY_MS);
    if (tehranWeekday(at) !== FRIDAY) left -= 1;
  }
  return at;
}

function jalaliDayMonth(d: Date): { day: string; month: string } | null {
  try {
    const parts = new Intl.DateTimeFormat(FA_LOCALE, { timeZone: TEHRAN_TZ, day: "numeric", month: "long" }).formatToParts(d);
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    return day === "" || month === "" ? null : { day, month };
  } catch {
    return null;
  }
}

export function formatDeliveryRange(minDays: number, maxDays: number, now: Date = new Date()): string {
  if (!Number.isFinite(minDays) || !Number.isFinite(maxDays) || minDays < 0 || maxDays < 0) return "";
  if (Number.isNaN(now.getTime())) return "";
  const lo = Math.trunc(Math.min(minDays, maxDays));
  const hi = Math.trunc(Math.max(minDays, maxDays));
  const start = jalaliDayMonth(addWorkingDays(now, lo));
  const end = jalaliDayMonth(addWorkingDays(now, hi));
  if (start === null || end === null) return "";
  if (start.day === end.day && start.month === end.month) return `${start.day} ${start.month}`;
  if (start.month === end.month) return `${start.day} ${RANGE_TO} ${end.day} ${end.month}`;
  return `${start.day} ${start.month} ${RANGE_TO} ${end.day} ${end.month}`;
}

export function formatRelative(iso: string, now?: number): string {
  const d = parseIso(iso);
  if (!d) return "";
  const diff = (now ?? Date.now()) - d.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE_MS) return REL_NOW;
  const tail = diff >= 0 ? REL_PAST : REL_FUTURE;
  if (abs < HOUR_MS) return `${faInt(Math.floor(abs / MINUTE_MS))} ${UNIT_MINUTE} ${tail}`;
  if (abs < DAY_MS) return `${faInt(Math.floor(abs / HOUR_MS))} ${UNIT_HOUR} ${tail}`;
  if (abs < WEEK_MS) return `${faInt(Math.floor(abs / DAY_MS))} ${UNIT_DAY} ${tail}`;
  if (abs < MONTH_MS) return `${faInt(Math.floor(abs / WEEK_MS))} ${UNIT_WEEK} ${tail}`;
  return formatJalali(iso, "long");
}

export function truncateWords(s: string, max: number): string {
  if (typeof s !== "string") return "";
  const trimmed = s.trim();
  const words = trimmed === "" ? [] : trimmed.split(/\s+/);
  const limit = Math.trunc(max);
  if (words.length <= limit) return trimmed;
  const kept = words.slice(0, Math.max(0, limit));
  const last = kept[kept.length - 1];
  if (last !== undefined) kept[kept.length - 1] = last.replace(TRAILING_PUNCT_RE, "");
  return kept.join(" ") + ELLIPSIS;
}

export function splitLatinRuns(s: string): LatinRun[] {
  if (typeof s !== "string" || s === "") return [];
  const parts = s.split(WHITESPACE_SPLIT_RE);
  const runs: LatinRun[] = [];
  for (let i = 0; i < parts.length; i++) {
    const text = parts[i] ?? "";
    if (text === "") continue;
    // Odd indices are the captured whitespace separators: they belong to a Latin run only when
    // the tokens on both sides are Latin, so " HS08 " keeps its spaces in the Persian runs.
    const latin =
      i % 2 === 1
        ? isLatinToken(parts[i - 1] ?? "") && isLatinToken(parts[i + 1] ?? "")
        : isLatinToken(text);
    const previous = runs[runs.length - 1];
    if (previous && previous.latin === latin) previous.text += text;
    else runs.push({ text, latin });
  }
  return runs;
}
