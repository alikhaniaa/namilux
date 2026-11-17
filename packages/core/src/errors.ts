export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "OUT_OF_STOCK"
  | "ON_REQUEST"
  | "PRICE_CHANGED"
  | "COUPON_INVALID"
  | "PAYMENT_FAILED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_LOCKED"
  | "CAPTCHA_REQUIRED"
  | "CHECKOUT_DISABLED"
  | "MAINTENANCE"
  | "INTERNAL";

export const ERROR_CODES: readonly ErrorCode[] = [
  "VALIDATION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "CONFLICT",
  "OUT_OF_STOCK",
  "ON_REQUEST",
  "PRICE_CHANGED",
  "COUPON_INVALID",
  "PAYMENT_FAILED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "CAPTCHA_REQUIRED",
  "CHECKOUT_DISABLED",
  "MAINTENANCE",
  "INTERNAL",
];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  OUT_OF_STOCK: 409,
  ON_REQUEST: 409,
  PRICE_CHANGED: 409,
  COUPON_INVALID: 422,
  PAYMENT_FAILED: 402,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_LOCKED: 423,
  CAPTCHA_REQUIRED: 428,
  CHECKOUT_DISABLED: 503,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

/** Default customer-facing copy. Tone per v2 §10.3: plural second person, no exclamation marks. */
export const ERROR_FA: Record<ErrorCode, string> = {
  VALIDATION: "اطلاعات ارسال‌شده معتبر نیست.",
  UNAUTHORIZED: "برای ادامه باید وارد حساب خود شوید.",
  FORBIDDEN: "شما اجازهٔ انجام این کار را ندارید.",
  NOT_FOUND: "موردی یافت نشد.",
  RATE_LIMITED: "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
  CONFLICT: "این عملیات در وضعیت فعلی امکان‌پذیر نیست.",
  OUT_OF_STOCK: "موجودی این کالا کافی نیست.",
  ON_REQUEST: "قیمت این کالا استعلامی است و امکان خرید آنلاین ندارد.",
  PRICE_CHANGED: "قیمت یا موجودی سبد شما به‌روز شد. لطفاً دوباره بررسی کنید.",
  COUPON_INVALID: "این کد تخفیف معتبر نیست.",
  PAYMENT_FAILED: "پرداخت انجام نشد. می‌توانید دوباره تلاش کنید.",
  OTP_INVALID: "کد واردشده درست نیست.",
  OTP_EXPIRED: "کد منقضی شده است. کد جدید درخواست کنید.",
  OTP_LOCKED: "تعداد تلاش‌ها بیش از حد مجاز بود. کمی بعد کد جدید درخواست کنید.",
  CAPTCHA_REQUIRED: "برای ادامه، تأیید امنیتی لازم است.",
  CHECKOUT_DISABLED: "ثبت سفارش موقتاً غیرفعال است. برای خرید با ما تماس بگیرید.",
  MAINTENANCE: "سایت در حال به‌روزرسانی است. لطفاً کمی بعد مراجعه کنید.",
  INTERNAL: "خطایی رخ داد. لطفاً دوباره تلاش کنید.",
};

export class AppError extends Error {
  override readonly name = "AppError";
  ref?: string;

  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    public readonly fa: string,
    public readonly details?: unknown,
  ) {
    super(`${code}: ${fa}`);
  }
}

export function appError(
  code: ErrorCode,
  opts?: { fa?: string; details?: unknown; httpStatus?: number },
): AppError {
  return new AppError(code, opts?.httpStatus ?? ERROR_HTTP_STATUS[code], opts?.fa ?? ERROR_FA[code], opts?.details);
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Wrap anything thrown into an AppError; only INTERNAL receives the correlation ref. */
export function fromUnknown(e: unknown, ref: string): AppError {
  if (isAppError(e)) {
    if (e.code === "INTERNAL" && !e.ref) e.ref = ref;
    return e;
  }
  const err = appError("INTERNAL", { details: e });
  err.ref = ref;
  return err;
}

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: { code: ErrorCode; message: string; ref?: string; details?: unknown };
};
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export function toApiError(e: AppError): ApiErr {
  const error: ApiErr["error"] = { code: e.code, message: e.fa };
  if (e.ref) error.ref = e.ref;
  if (e.code === "VALIDATION" && e.details !== undefined) error.details = e.details;
  return { ok: false, error };
}
