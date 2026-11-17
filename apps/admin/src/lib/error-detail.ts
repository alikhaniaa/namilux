import { ERROR_FA, faDigits } from "@namilux/core/client";
import { fa, type FaKey } from "@/i18n/fa";

/**
 * One vocabulary for admin errors, shared by the server handler (`http-handler.ts`), the browser
 * client (`api-client.ts`) and the generic form.
 *
 * Two rules shape everything here:
 *  - nothing the caller sent is ever echoed back. Field errors are rebuilt from a bounded list of
 *    Zod issue codes, and a schema's own message is kept only when it is Persian-only, short and
 *    free of the values in the request;
 *  - every failure carries a stable reason code next to the request ref, so a support message can
 *    name what happened without a stack, SQL or the input travelling with it.
 */

/** The stable reason codes the admin handler, the client and the form agree on. */
export const ERROR_REASONS = {
  ORIGIN_REJECTED: "ORIGIN_REJECTED",
  CSRF_EXPIRED: "CSRF_EXPIRED",
  BODY_TOO_LARGE: "BODY_TOO_LARGE",
  INVALID_JSON: "INVALID_JSON",
  FIELD_VALIDATION: "FIELD_VALIDATION",
  VALIDATION: "VALIDATION",
  SESSION_REQUIRED: "SESSION_REQUIRED",
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SUDO_REQUIRED: "SUDO_REQUIRED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  /** Client-side only: fetch itself failed. */
  NETWORK: "NETWORK",
  /** Client-side only: the request was aborted before it settled. */
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  /** Client-side only: the response was not the JSON envelope (empty or truncated). */
  BAD_RESPONSE: "BAD_RESPONSE",
  INTERNAL: "INTERNAL",
} as const;
export type ErrorReason = (typeof ERROR_REASONS)[keyof typeof ERROR_REASONS];

type ReasonCopy = { readonly message: string; readonly recovery?: string };

/**
 * What the user reads for a reason: one sentence of what happened and, where it helps, one of what
 * to do next. Tone per the v2 copy rules - plural second person, no exclamation marks.
 */
export const REASON_FA: Record<ErrorReason, ReasonCopy> = {
  ORIGIN_REJECTED: {
    message: "این درخواست از نشانی معتبر پنل نیامده است.",
    recovery: "صفحهٔ پنل را دوباره باز کنید و همین کار را از داخل پنل انجام دهید.",
  },
  CSRF_EXPIRED: {
    message: "اعتبار امنیتی این صفحه منقضی شده است.",
    recovery: "صفحه را دوباره بارگذاری کنید و دوباره ذخیره کنید.",
  },
  BODY_TOO_LARGE: {
    message: "حجم اطلاعات ارسالی بیش از حد مجاز است.",
    recovery: "متن یا فایل را کوتاه‌تر کنید و دوباره تلاش کنید.",
  },
  INVALID_JSON: {
    message: "ساختار اطلاعات ارسالی خوانده نشد.",
    recovery: "صفحه را دوباره بارگذاری کنید و دوباره تلاش کنید.",
  },
  FIELD_VALIDATION: {
    message: "بعضی فیلدها نیاز به اصلاح دارند.",
    recovery: "موردهای مشخص‌شده را اصلاح کنید و دوباره ذخیره کنید.",
  },
  VALIDATION: { message: "اطلاعات ارسالی پذیرفته نشد.", recovery: "مقادیر را بررسی کنید و دوباره تلاش کنید." },
  SESSION_REQUIRED: { message: "نشست شما تمام شده است.", recovery: "دوباره وارد حساب خود شوید." },
  PASSWORD_CHANGE_REQUIRED: { message: "اول باید رمز عبور یک‌بارمصرف را عوض کنید.", recovery: "برای ادامه، رمز عبور تازه‌ای انتخاب کنید." },
  PERMISSION_DENIED: { message: "دسترسی لازم برای این کار را ندارید.", recovery: "برای گرفتن دسترسی با مدیر ارشد هماهنگ کنید." },
  SUDO_REQUIRED: { message: "برای این کار باید دوباره تأیید دومرحله‌ای انجام شود.", recovery: "کد تأیید دومرحله‌ای را وارد کنید." },
  NOT_FOUND: { message: "این مورد پیدا نشد.", recovery: "ممکن است حذف شده باشد؛ فهرست را دوباره بارگذاری کنید." },
  CONFLICT: { message: "این عملیات در وضعیت فعلی ممکن نیست.", recovery: "اطلاعات را به‌روز کنید و دوباره تلاش کنید." },
  RATE_LIMITED: { message: "تعداد درخواست‌ها بیش از حد مجاز است.", recovery: "کمی بعد دوباره تلاش کنید." },
  NETWORK: { message: "ارتباط با سرور برقرار نشد.", recovery: "اتصال اینترنت را بررسی کنید و دوباره تلاش کنید." },
  REQUEST_CANCELLED: { message: "درخواست پیش از پایان لغو شد." },
  BAD_RESPONSE: { message: "پاسخ سرور خوانده نشد.", recovery: "کمی بعد دوباره تلاش کنید؛ اگر ادامه داشت کد پیگیری را برای پشتیبانی بفرستید." },
  INTERNAL: { message: "خطایی رخ داد.", recovery: "دوباره تلاش کنید؛ اگر ادامه داشت کد پیگیری را برای پشتیبانی بفرستید." },
};

const DEFAULT_MESSAGE = "مشکلی پیش آمد.";

/** A field-level problem, addressed by the same dot path the form holds its values under. */
export type FieldError = { path: string; message: string; label?: string };

const MAX_FIELD_ERRORS = 20;
const MAX_PATH = 120;
const MAX_MESSAGE = 160;
const MAX_CHECKED_VALUES = 60;
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The recovery sentence for a reason, when one is known. */
export function reasonRecovery(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return (REASON_FA as Record<string, ReasonCopy | undefined>)[reason]?.recovery;
}

/** The sentence the handler sends as `error.message` for a reason. */
export function reasonMessage(reason: ErrorReason): string {
  return REASON_FA[reason].message;
}

// ── field labels ────────────────────────────────────────────────────────────────────────────────

/**
 * i18n prefixes tried, in order, for a field name. A path like `price` reads «قیمت» because
 * `products.price` exists; anything without a label keeps its schema name, which is a key rather
 * than caller text.
 */
const LABEL_PREFIXES = [
  "products.",
  "cat.",
  "brands.",
  "collections.",
  "coupons.",
  "banners.",
  "posts.",
  "orders.",
  "customers.",
  "settingsField.",
  "form.",
  "common.",
] as const;

/**
 * Field names the service layer throws under `details.field` whose i18n key is missing or means
 * something else (`products.title` is the page heading «محصولات», not a banner's title). Checked
 * before the prefixes.
 */
const FIELD_LABEL_FA: Record<string, string> = {
  title: "عنوان",
  name: "نام",
  slug: "نشانی صفحه در سایت",
  startsAt: "تاریخ شروع",
  endsAt: "تاریخ پایان",
  ctaLabel: "متن دکمه",
  ctaHref: "لینک دکمه",
  href: "لینک",
  label: "عنوان",
  badge: "نشان",
  parentId: "دستهٔ بالاتر",
  mediaLightId: "تصویر روشن",
  mediaDarkId: "تصویر تیره",
  imageMediaId: "تصویر",
  redirectTo: "مقصد تغییر مسیر",
  toPath: "نشانی مقصد",
  question: "پرسش",
  answerHtml: "پاسخ",
  messages: "پیام‌ها",
  items: "موردها",
  key: "کلید",
  id: "شناسه",
};

function leafLabel(leaf: string): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(leaf)) return undefined;
  if (Object.prototype.hasOwnProperty.call(FIELD_LABEL_FA, leaf)) return FIELD_LABEL_FA[leaf];
  for (const prefix of LABEL_PREFIXES) {
    const key = `${prefix}${leaf}`;
    if (Object.prototype.hasOwnProperty.call(fa, key)) return fa[key as FaKey];
  }
  return undefined;
}

/** The label of a path's leaf, with the row it sits in when the path runs through a list. */
export function fieldLabel(path: string): string | undefined {
  const segments = path.split(".");
  const label = leafLabel(segments[segments.length - 1] ?? path);
  if (label === undefined) return undefined;
  const row = [...segments].reverse().find((s) => /^\d{1,6}$/.test(s));
  return row === undefined ? label : `${label} (ردیف ${faDigits(Number(row) + 1)})`;
}

// ── safe field errors out of Zod issues ─────────────────────────────────────────────────────────

/** Every leaf string/number that arrived with the request, used only to prove a message is clean. */
function inputValues(input: unknown, out: string[] = [], depth = 0): string[] {
  if (out.length >= MAX_CHECKED_VALUES || depth > 4) return out;
  if (typeof input === "string") {
    const value = input.trim();
    if (value.length >= 2 && value.length <= 64) out.push(value);
    return out;
  }
  if (typeof input === "number") {
    const value = String(input);
    if (value.length >= 4) out.push(value);
    return out;
  }
  if (Array.isArray(input)) {
    for (const item of input.slice(0, 12)) inputValues(item, out, depth + 1);
    return out;
  }
  const record = asRecord(input);
  if (record !== null) for (const value of Object.values(record).slice(0, 20)) inputValues(value, out, depth + 1);
  return out;
}

/**
 * Persian copy with punctuation, ZWNJ and digits only - the shape a hand-written message has. An
 * English default ("Invalid input: expected string…") or a message that concatenated a value in
 * fails this and is replaced by a synthesized one.
 */
const SAFE_MESSAGE = /^[\u0600-\u06FF\u200c\s\u06F0-\u06F9\u0660-\u0669\d.,؛،:«»()!؟?\-–—_/%٪…+*=]+$/u;

function curatedMessage(raw: unknown, values: readonly string[]): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim().replace(/\s+/gu, " ");
  if (text === "" || text.length > MAX_MESSAGE) return undefined;
  if (!SAFE_MESSAGE.test(text)) return undefined;
  for (const value of values) if (text.includes(value)) return undefined;
  return text;
}

const TYPE_FA: Record<string, string> = {
  string: "متن",
  number: "عدد",
  bigint: "عدد",
  boolean: "بله یا خیر",
  date: "تاریخ",
  array: "فهرست",
  object: "ساختار",
  null: "خالی",
  undefined: "خالی",
  file: "فایل",
};

const FORMAT_FA: Record<string, string> = {
  email: "ایمیل معتبر وارد کنید",
  url: "نشانی معتبر وارد کنید",
  uuid: "شناسهٔ معتبر وارد کنید",
  guid: "شناسهٔ معتبر وارد کنید",
  nanoid: "شناسهٔ معتبر وارد کنید",
  cuid: "شناسهٔ معتبر وارد کنید",
  cuid2: "شناسهٔ معتبر وارد کنید",
  ulid: "شناسهٔ معتبر وارد کنید",
  ksuid: "شناسهٔ معتبر وارد کنید",
  xid: "شناسهٔ معتبر وارد کنید",
  jwt: "توکن معتبر وارد کنید",
  emoji: "شکلک معتبر وارد کنید",
  ipv4: "نشانی آی‌پی معتبر وارد کنید",
  ipv6: "نشانی آی‌پی معتبر وارد کنید",
  cidrv4: "بازهٔ آی‌پی معتبر وارد کنید",
  cidrv6: "بازهٔ آی‌پی معتبر وارد کنید",
  base64: "مقدار Base64 معتبر وارد کنید",
  base64url: "مقدار Base64 معتبر وارد کنید",
  e164: "شمارهٔ تلفن بین‌المللی معتبر وارد کنید",
  date: "تاریخ معتبر وارد کنید",
  datetime: "تاریخ و ساعت معتبر وارد کنید",
  time: "ساعت معتبر وارد کنید",
  duration: "بازهٔ زمانی معتبر وارد کنید",
  regex: "قالب این مقدار درست نیست",
  starts_with: "مقدار با قالب درست شروع نمی‌شود",
  ends_with: "مقدار با قالب درست تمام نمی‌شود",
  includes: "مقدار قالب درست را ندارد",
};

/** A number the issue carries (a bound), as Persian digits; undefined when it is not a number. */
function boundFa(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return faDigits(value);
  if (typeof value === "string" && /^\d{1,12}$/.test(value)) return faDigits(value);
  return undefined;
}

/**
 * Whether the request held something at an issue's path. Zod 4 leaves `input` off its issues unless
 * asked, so a wrong-typed value and a missing one look alike on the issue itself; the parsed body
 * tells them apart. Only presence is read - the value never reaches a message.
 */
function suppliedAt(issue: Record<string, unknown>, input: unknown): boolean {
  if ("input" in issue) return issue.input !== undefined && issue.input !== null;
  if (!Array.isArray(issue.path) || issue.path.length > 12) return false;
  let cur: unknown = input;
  for (const segment of issue.path) {
    if (typeof segment !== "string" && typeof segment !== "number") return false;
    if (typeof cur !== "object" || cur === null || !Object.prototype.hasOwnProperty.call(cur, segment)) return false;
    cur = (cur as Record<string | number, unknown>)[segment];
  }
  return cur !== undefined && cur !== null;
}

function synthesizedMessage(issue: Record<string, unknown>, supplied: boolean): string {
  const code = typeof issue.code === "string" ? issue.code : "";
  switch (code) {
    case "invalid_type": {
      const expected = typeof issue.expected === "string" ? issue.expected : "";
      if (!supplied && expected !== "undefined" && expected !== "") return "این فیلد لازم است";
      return `مقدار این فیلد باید ${TYPE_FA[expected] ?? "در قالب درست"} باشد`;
    }
    case "too_small": {
      const bound = boundFa(issue.minimum);
      const origin = typeof issue.origin === "string" ? issue.origin : "";
      const more = issue.inclusive === false;
      if (bound === undefined) return "مقدار این فیلد کمتر از حد مجاز است";
      if (origin === "string") return more ? `تعداد نویسه‌ها باید بیشتر از ${bound} باشد` : `تعداد نویسه‌ها باید دست‌کم ${bound} باشد`;
      if (origin === "array" || origin === "set") return more ? `باید بیشتر از ${bound} مورد باشد` : `باید دست‌کم ${bound} مورد باشد`;
      return more ? `مقدار باید بیشتر از ${bound} باشد` : `مقدار باید دست‌کم ${bound} باشد`;
    }
    case "too_big": {
      const bound = boundFa(issue.maximum);
      const origin = typeof issue.origin === "string" ? issue.origin : "";
      const less = issue.inclusive === false;
      if (bound === undefined) return "مقدار این فیلد بیشتر از حد مجاز است";
      if (origin === "string") return less ? `تعداد نویسه‌ها باید کمتر از ${bound} باشد` : `تعداد نویسه‌ها باید حداکثر ${bound} باشد`;
      if (origin === "array" || origin === "set") return less ? `باید کمتر از ${bound} مورد باشد` : `باید حداکثر ${bound} مورد باشد`;
      return less ? `مقدار باید کمتر از ${bound} باشد` : `مقدار باید حداکثر ${bound} باشد`;
    }
    case "invalid_format": {
      const format = typeof issue.format === "string" ? issue.format : "";
      return FORMAT_FA[format] ?? "قالب این مقدار درست نیست";
    }
    case "not_multiple_of": {
      const divisor = boundFa(issue.divisor);
      return divisor === undefined ? "مقدار این فیلد مضرب درستی نیست" : `مقدار باید مضربی از ${divisor} باشد`;
    }
    case "invalid_value":
      return "مقدار انتخابی مجاز نیست";
    case "invalid_union":
      return "مقدار با هیچ‌یک از حالت‌های مجاز نمی‌خواند";
    case "unrecognized_keys":
      return "فیلد ناشناخته‌ای در اطلاعات ارسالی هست";
    case "invalid_key":
      return "کلید ناشناخته‌ای در اطلاعات ارسالی هست";
    case "invalid_element":
      return "یکی از اعضای فهرست نامعتبر است";
    case "custom":
      return "مقدار این فیلد پذیرفته نشد";
    default:
      return "مقدار این فیلد معتبر نیست";
  }
}

/**
 * The dot path of an issue, or "" when it cannot be proven schema-only. `invalid_key` and
 * `unrecognized_keys` name caller-chosen keys, and any segment that is not a plain identifier
 * could be caller text - both are reported at form level instead of being echoed.
 */
function safeIssuePath(path: unknown, code: string): string {
  if (code === "invalid_key" || code === "unrecognized_keys") return "";
  if (!Array.isArray(path) || path.length === 0 || path.length > 6) return "";
  const segments: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0) {
      segments.push(String(segment));
      continue;
    }
    if (typeof segment === "string" && SEGMENT.test(segment)) {
      segments.push(segment);
      continue;
    }
    return "";
  }
  const joined = segments.join(".");
  return joined.length <= MAX_PATH ? joined : "";
}

function issueMessage(issue: Record<string, unknown>, values: readonly string[], input: unknown): string {
  return curatedMessage(issue.message, values) ?? synthesizedMessage(issue, suppliedAt(issue, input));
}

/**
 * Turn Zod issues into the bounded `{path, message, label}` list the client renders. `input` is the
 * parsed body, used only to reject a message that repeats something the caller sent and to tell a
 * missing value from a wrong-typed one.
 */
export function fieldErrorsFromIssues(issues: readonly unknown[], input?: unknown): FieldError[] {
  const values = inputValues(input);
  const out: FieldError[] = [];
  const seen = new Set<string>();
  for (const raw of issues) {
    if (out.length >= MAX_FIELD_ERRORS) break;
    const issue = asRecord(raw);
    if (issue === null) continue;
    const code = typeof issue.code === "string" ? issue.code : "";
    const path = safeIssuePath(issue.path, code);
    const message = issueMessage(issue, values, input);
    const dedupe = `${path}\u0000${message}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const label = fieldLabel(path);
    out.push(label === undefined ? { path, message } : { path, message, label });
  }
  return out;
}

// ── reading field errors back out of a response ─────────────────────────────────────────────────

function safePathString(value: unknown): string | undefined {
  const text = nonEmpty(value);
  if (text === undefined || text.length > MAX_PATH) return undefined;
  const segments = text.split(".");
  if (segments.length === 0 || segments.length > 6) return undefined;
  for (const segment of segments) {
    if (!SEGMENT.test(segment) && !/^\d{1,6}$/.test(segment)) return undefined;
  }
  return text;
}

function safeMessage(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : undefined;
  return text === undefined || text === "" ? undefined : text.slice(0, MAX_MESSAGE);
}

const REASON_CODE = /^[a-z][a-z0-9_]{0,40}$/;

/** A service `details.reason` when it is a plain snake_case code; anything else is not ours to show. */
export function detailReason(details: unknown): string | undefined {
  const reason = asRecord(details)?.reason;
  return typeof reason === "string" && REASON_CODE.test(reason) ? reason : undefined;
}

/**
 * The correction for the `{field, reason}` pairs core services throw (`invalid(field, reason)`),
 * written without the value. A bound is read only from a numeric `max`; nothing else in the
 * details is shown. An unlisted reason gets no invented cause - the code stays in the diagnostic.
 */
function businessReasonMessage(reason: string, details: Record<string, unknown>): string | undefined {
  const max = boundFa(details.max);
  switch (reason) {
    case "required":
      return "این فیلد لازم است؛ مقداری وارد یا انتخاب کنید.";
    case "too_long":
      return max === undefined ? "این متن از حد مجاز بلندتر است؛ کوتاه‌ترش کنید." : `حداکثر ${max} نویسه مجاز است؛ کوتاه‌ترش کنید.`;
    case "too_many":
      return max === undefined ? "تعداد موردها از حد مجاز بیشتر است؛ چند مورد را حذف کنید." : `حداکثر ${max} مورد مجاز است؛ چند مورد را حذف کنید.`;
    case "exclamation":
      return "علامت تعجب مجاز نیست؛ آن را حذف کنید.";
    case "latin_digit":
      return "عددها را با رقم فارسی بنویسید (مثلاً ۲۰ به‌جای 20).";
    case "unsafe_href":
      return "لینک باید با / (صفحه‌ای از همین فروشگاه) یا https:// شروع شود و فاصله نداشته باشد.";
    case "must_be_site_relative":
      return "نشانی باید با / شروع شود (صفحه‌ای از همین فروشگاه).";
    case "cta_pair_required":
      return "متن دکمه و لینک باید با هم پر شوند یا هر دو خالی بمانند.";
    case "invalid_window":
    case "window_inverted":
      return "تاریخ پایان باید بعد از تاریخ شروع باشد.";
    case "invalid_date":
      return "تاریخ خوانا نیست؛ دوباره از تقویم انتخاب کنید.";
    case "duplicate":
      return "این مورد تکراری است؛ نمونهٔ تکراری را حذف کنید.";
    case "unknown_media":
      return "تصویر انتخاب‌شده در کتابخانهٔ رسانه پیدا نشد؛ تصویر را دوباره انتخاب کنید.";
    case "slug_taken":
    case "sibling_slug_taken":
      return "این نشانی قبلاً برای صفحهٔ دیگری ثبت شده است. کد مدل یا یک شماره به پایان نشانی اضافه کنید و دوباره ذخیره کنید.";
    case "key_taken":
      return "این مقدار پیش‌تر برای مورد دیگری ثبت شده است؛ مقدار دیگری انتخاب کنید.";
    case "not_latin_slug":
      return "نشانی صفحه را فقط با حروف کوچک انگلیسی، رقم و خط تیره بنویسید.";
    case "invalid_slug":
      return "نشانی صفحه نباید فاصله یا نویسه‌های / ? # % داشته باشد.";
    case "unknown_parent":
      return "دستهٔ بالاتر پیدا نشد؛ فهرست را تازه کنید و دوباره انتخاب کنید.";
    case "cycle":
      return "یک دسته نمی‌تواند زیرمجموعهٔ خودش یا زیردسته‌هایش باشد؛ دستهٔ بالاتر دیگری انتخاب کنید.";
    case "redirect_loop":
      return "این تغییر مسیر به خودش برمی‌گردد؛ مقصد دیگری انتخاب کنید.";
    case "target_not_live":
      return "صفحهٔ مقصد منتشر نشده است؛ مقصدی منتشرشده انتخاب کنید.";
    default:
      return undefined;
  }
}

const UNKNOWN_REASON_FA = "مقدار این فیلد پذیرفته نشد؛ آن را بررسی و اصلاح کنید.";

/**
 * The `{path, message}` pairs a response carries - under `details.fieldErrors`, as the bare
 * `details` array core already uses for validation issues, or as the single `{field, reason}` a core
 * service throws. Anything else is ignored.
 */
export function fieldErrorsFromDetails(details: unknown): FieldError[] {
  const record = asRecord(details);
  if (record !== null && !Array.isArray(record.fieldErrors)) {
    const path = safePathString(record.field);
    const reason = detailReason(record);
    if (path === undefined || reason === undefined) return [];
    const message = businessReasonMessage(reason, record) ?? UNKNOWN_REASON_FA;
    const label = fieldLabel(path);
    return [label === undefined ? { path, message } : { path, message, label }];
  }
  const list = Array.isArray(details) ? details : record !== null && Array.isArray(record.fieldErrors) ? record.fieldErrors : [];
  const out: FieldError[] = [];
  for (const raw of list) {
    if (out.length >= MAX_FIELD_ERRORS) break;
    const entry = asRecord(raw);
    if (entry === null) continue;
    const path = safePathString(entry.path) ?? "";
    const message = safeMessage(entry.message);
    if (message === undefined) continue;
    const label = safeMessage(entry.label) ?? fieldLabel(path);
    out.push(label === undefined ? { path, message } : { path, message, label });
  }
  return out;
}

// ── the one-line message every caller may show ──────────────────────────────────────────────────

export type ErrorShape = {
  code?: string | undefined;
  message?: string | undefined;
  ref?: string | undefined;
  reason?: string | undefined;
  details?: unknown;
};

const MAX_TEXT_FIELDS = 3;

/** Compared without the closing punctuation, so «… باشد.» and «… باشد» count as one sentence. */
function sameSentence(a: string, b: string): boolean {
  const trim = (s: string): string => s.trim().replace(/[.。؛،!؟?]+$/u, "");
  return trim(a) === trim(b);
}

/**
 * The text every existing `e.message` caller shows: what happened, what to do next, each field to
 * fix with its correction when the server named them, and the diagnostic pair support asks for.
 * `withFields: false` is the short form for a screen that lists the fields itself.
 */
export function readableErrorText(input: ErrorShape, opts: { withFields?: boolean } = {}): string {
  const code = nonEmpty(input.code) ?? "INTERNAL";
  const reason = nonEmpty(input.reason);
  const knownCopy = (REASON_FA as Record<string, ReasonCopy | undefined>)[reason ?? code];
  const copy = knownCopy ?? (code === "UNAUTHORIZED" ? REASON_FA.SESSION_REQUIRED : code === "FORBIDDEN" ? REASON_FA.PERMISSION_DENIED : REASON_FA.INTERNAL);
  const base = nonEmpty(input.message) ?? knownCopy?.message ?? (ERROR_FA as Record<string, string>)[code] ?? DEFAULT_MESSAGE;
  const parts = [base];
  const recovery = copy?.recovery;
  if (recovery !== undefined && !base.includes(recovery)) parts.push(recovery);
  if (opts.withFields !== false) {
    // A service that already wrote the correction as its message (the promo bar does) is not
    // repeated back as a field line.
    const fields = fieldErrorsFromDetails(input.details).filter((f) => !sameSentence(f.message, base));
    const shown = fields.slice(0, MAX_TEXT_FIELDS).map((f) => {
      const name = f.label ?? "بخش مشخص‌شده";
      const message = f.message.replace(/\.+$/u, "");
      return name === "" ? message : `${name}: ${message}`;
    });
    if (shown.length > 0) {
      const rest = fields.length - shown.length;
      parts.push(`موردهای نیازمند اصلاح: ${shown.join("؛ ")}${rest > 0 ? ` و ${faDigits(rest)} مورد دیگر` : ""}`);
    }
  }
  const ref = nonEmpty(input.ref);
  // Codes remain on ApiError / the response for support; the operator reads only the correction.
  if (ref !== undefined) parts.push(`کد پیگیری: ${ref}`);
  return parts.join(" ");
}
