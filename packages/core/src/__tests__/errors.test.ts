import { describe, expect, it } from "vitest";
import {
  AppError,
  ERROR_CODES,
  ERROR_FA,
  ERROR_HTTP_STATUS,
  appError,
  fromUnknown,
  isAppError,
  toApiError,
  type ApiResponse,
  type ErrorCode,
} from "../errors";

/** the spec + errors.ts rules - the status map is fixed data, restated here on purpose. */
const DOC_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  PAYMENT_FAILED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OUT_OF_STOCK: 409,
  ON_REQUEST: 409,
  PRICE_CHANGED: 409,
  COUPON_INVALID: 422,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_LOCKED: 423,
  CAPTCHA_REQUIRED: 428,
  RATE_LIMITED: 429,
  CHECKOUT_DISABLED: 503,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

describe("codes", () => {
  it("every code has a status and Persian copy", () => {
    expect(ERROR_CODES.length).toBe(18);
    expect(new Set(ERROR_CODES).size).toBe(18);
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBe(DOC_STATUS[code]);
      expect(typeof ERROR_FA[code]).toBe("string");
      expect(ERROR_FA[code].length).toBeGreaterThan(3);
    }
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(ERROR_FA).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("no fa message contains an exclamation mark or a Latin digit", () => {
    for (const code of ERROR_CODES) {
      const fa = ERROR_FA[code];
      expect(fa, code).not.toMatch(/[!\uFF01]/);
      expect(fa, code).not.toMatch(/[0-9]/);
      // `fa` is the only field a customer sees - it must never carry internals (rules).
      expect(fa, code).not.toMatch(/(select |insert |[A-Za-z]:\|\/src\/|at Object|Error:)/i);
      expect(fa, code).toMatch(/[\u0600-\u06FF]/);
    }
  });
});

describe("appError", () => {
  it('appError("VALIDATION") uses the default status 400 and the default copy', () => {
    const e = appError("VALIDATION");
    expect(e).toBeInstanceOf(AppError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("VALIDATION");
    expect(e.httpStatus).toBe(400);
    expect(e.fa).toBe(ERROR_FA.VALIDATION);
    expect(e.details).toBeUndefined();
    expect(e.ref).toBeUndefined();
    expect(e.name).toBe("AppError");
    expect(e.message).toBe(`VALIDATION: ${ERROR_FA.VALIDATION}`);
  });

  it('appError("NOT_FOUND", { fa: "…" }) overrides the copy only', () => {
    const e = appError("NOT_FOUND", { fa: "این کالا پیدا نشد." });
    expect(e.fa).toBe("این کالا پیدا نشد.");
    expect(e.httpStatus).toBe(404);
    expect(e.code).toBe("NOT_FOUND");
  });

  it("carries details and an explicit httpStatus when asked", () => {
    const e = appError("CONFLICT", { details: { field: "qty" }, httpStatus: 410 });
    expect(e.httpStatus).toBe(410);
    expect(e.details).toEqual({ field: "qty" });
    expect(e.fa).toBe(ERROR_FA.CONFLICT);
  });

  it("isAppError narrows only AppError instances", () => {
    expect(isAppError(appError("INTERNAL"))).toBe(true);
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(isAppError("VALIDATION")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError({ code: "VALIDATION", httpStatus: 400, fa: "x" })).toBe(false);
  });
});

describe("fromUnknown", () => {
  it("fromUnknown wraps unknown as INTERNAL", () => {
    const original = new Error("boom");
    const e = fromUnknown(original, "r1");
    expect(e.code).toBe("INTERNAL");
    expect(e.httpStatus).toBe(500);
    expect(e.ref).toBe("r1");
    expect(e.fa).toBe(ERROR_FA.INTERNAL);
    expect(e.details).toBe(original);
    expect(e.fa).not.toContain("boom");
  });

  it("wraps non-Error throwables too", () => {
    for (const thrown of ["boom", 42, null, undefined, { sql: "select 1" }]) {
      const e = fromUnknown(thrown, "r2");
      expect(e.code).toBe("INTERNAL");
      expect(e.ref).toBe("r2");
      expect(e.details).toBe(thrown);
    }
  });

  it("fromUnknown passes AppError through", () => {
    const original = appError("CONFLICT");
    const e = fromUnknown(original, "r1");
    expect(e).toBe(original);
    expect(e.ref).toBeUndefined();
    expect(e.code).toBe("CONFLICT");
  });

  it("attaches the ref to a pass-through INTERNAL only when it has none", () => {
    const fresh = appError("INTERNAL");
    expect(fromUnknown(fresh, "r3").ref).toBe("r3");

    const already = appError("INTERNAL");
    already.ref = "first";
    expect(fromUnknown(already, "second").ref).toBe("first");
  });
});

describe("toApiError", () => {
  it("toApiError hides INTERNAL details and keeps VALIDATION details", () => {
    const internal = fromUnknown(new Error("select * from customers"), "r9");
    const internalBody = toApiError(internal);
    expect(internalBody).toEqual({ ok: false, error: { code: "INTERNAL", message: ERROR_FA.INTERNAL, ref: "r9" } });
    expect(internalBody.error.details).toBeUndefined();
    expect(JSON.stringify(internalBody)).not.toContain("select");

    const issues = [{ path: "lines.0.qty", message: "مقدار معتبر نیست." }];
    const validation = appError("VALIDATION", { details: issues });
    expect(toApiError(validation)).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: ERROR_FA.VALIDATION, details: issues },
    });
  });

  it("omits ref and details when they are absent", () => {
    expect(toApiError(appError("UNAUTHORIZED"))).toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED", message: ERROR_FA.UNAUTHORIZED },
    });
    expect(Object.keys(toApiError(appError("UNAUTHORIZED")).error)).toEqual(["code", "message"]);
  });

  it("drops details for every non-VALIDATION code", () => {
    for (const code of ERROR_CODES) {
      const body = toApiError(appError(code, { details: { secret: "token" } }));
      if (code === "VALIDATION") expect(body.error.details).toEqual({ secret: "token" });
      else expect(body.error.details).toBeUndefined();
    }
  });

  it("the envelope discriminates on ok", () => {
    const ok: ApiResponse<{ id: number }> = { ok: true, data: { id: 1 } };
    const err: ApiResponse<{ id: number }> = toApiError(appError("NOT_FOUND"));
    expect(ok.ok ? ok.data.id : null).toBe(1);
    expect(err.ok ? null : err.error.code).toBe("NOT_FOUND");
  });
});
