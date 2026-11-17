import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiUpload, setSudoHandler } from "../api-client";

/**
 * The browser client: what a screen can read off a failure (code, reason, ref, field errors), the
 * readable line its `message` already is, and the one retry it is allowed to make.
 */
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("expected the request to fail");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setSudoHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a refusal envelope", () => {
  it("puts the duplicate product address conflict on the editable address field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: {
      code: "CONFLICT", details: { field: "slug", reason: "slug_taken", slug: "نینجا" },
    } }, 409));
    const err = await failure(api("/api/products", { method: "POST", body: { slug: "نینجا" } }));
    expect(err.code).toBe("CONFLICT");
    expect(err.fieldErrors[0]?.path).toBe("slug");
    expect(err.fieldErrors[0]?.message).toContain("دوباره ذخیره کنید");
  });
  it("keeps code, status, reason, ref and field errors, and reads as one actionable line", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "بعضی فیلدها نیاز به اصلاح دارند.",
            ref: "r-9",
            reason: "FIELD_VALIDATION",
            details: { fieldErrors: [{ path: "price", message: "مقدار باید دست‌کم ۰ باشد" }] },
          },
        },
        400,
      ),
    );

    const err = await failure(api("/api/products", { method: "POST", body: { price: -1 } }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("VALIDATION");
    expect(err.status).toBe(400);
    expect(err.ref).toBe("r-9");
    expect(err.reason).toBe("FIELD_VALIDATION");
    expect(err.fieldErrors).toEqual([{ path: "price", message: "مقدار باید دست‌کم ۰ باشد", label: "قیمت" }]);
    expect(err.message).toContain("بعضی فیلدها نیاز به اصلاح دارند.");
    expect(err.message).toContain("موردهای مشخص‌شده را اصلاح کنید");
    expect(err.message).toContain("موردهای نیازمند اصلاح: قیمت: مقدار باید دست‌کم ۰ باشد");
    expect(err.brief).not.toContain("مقدار باید دست‌کم");
    expect(err.brief).toContain("پیگیری: r-9");
    expect(err.message).not.toContain("VALIDATION");
    expect(err.message).not.toContain("FIELD_VALIDATION");
    expect(err.message).toContain("پیگیری: r-9");
  });

  it("takes the ref off the response header when the body has none", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: { code: "INTERNAL", message: "خطایی رخ داد." } }, 500, { "x-request-id": "hdr-9" }));
    const err = await failure(api("/api/thing"));
    expect(err.ref).toBe("hdr-9");
    expect(err.status).toBe(500);
    expect(err.message).toContain("hdr-9");
  });

  it("names a session that has ended, with the recovery copy", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "UNAUTHORIZED", message: "برای ادامه باید وارد حساب خود شوید.", reason: "SESSION_REQUIRED", ref: "r-3" } }, 401),
    );
    const err = await failure(api("/api/products"));
    expect(err.reason).toBe("SESSION_REQUIRED");
    expect(err.message).toContain("دوباره وارد حساب خود شوید.");
  });
});

describe("failures that never reach the handler", () => {
  it("turns a fetch rejection into a NETWORK error without retrying", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = await failure(api("/api/thing"));
    expect(err.code).toBe("INTERNAL");
    expect(err.reason).toBe("NETWORK");
    expect(err.message).toContain("ارتباط با سرور برقرار نشد");
    expect(err.message).toContain("اتصال اینترنت را بررسی کنید");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an aborted request as cancelled", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abort);
    const err = await failure(api("/api/thing"));
    expect(err.reason).toBe("REQUEST_CANCELLED");
    expect(err.message).toContain("لغو شد");
  });

  it("reports a response that is not the JSON envelope, with its status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await failure(api("/api/thing"));
    expect(err.reason).toBe("BAD_RESPONSE");
    expect(err.status).toBe(502);
    expect(err.message).toContain("پاسخ سرور خوانده نشد");
  });

  it("reports a JSON body that is not an envelope (null) as BAD_RESPONSE, with the header ref", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 500, { "x-request-id": "hdr-1" }));
    const err = await failure(api("/api/thing"));
    expect(err.reason).toBe("BAD_RESPONSE");
    expect(err.ref).toBe("hdr-1");
  });

  it("accepts an empty 204 as success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api("/api/thing", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("retries", () => {
  const SUDO_REFUSAL = {
    ok: false,
    error: {
      code: "FORBIDDEN",
      message: "برای این کار باید رمز تأیید دومرحله‌ای را دوباره وارد کنید",
      reason: "SUDO_REQUIRED",
      ref: "r-5",
      details: { sudoRequired: true, permission: "staff.manage" },
    },
  };

  it("re-sends once after a fresh TOTP, with the same body", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(SUDO_REFUSAL, 403))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { saved: true } }));
    const sudo = vi.fn().mockResolvedValue(true);
    setSudoHandler(sudo);

    await expect(api<{ saved: boolean }>("/api/staff", { method: "POST", body: { name: "زهرا" } })).resolves.toEqual({ saved: true });
    expect(sudo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ name: "زهرا" }));
  });

  it("does not retry when the step-up is dismissed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SUDO_REFUSAL, 403));
    setSudoHandler(vi.fn().mockResolvedValue(false));
    const err = await failure(api("/api/staff", { method: "POST", body: { name: "زهرا" } }));
    expect(err.sudoRequired).toBe(true);
    expect(err.details).toMatchObject({ sudoRequired: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries an ordinary refusal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: { code: "INTERNAL", message: "خطایی رخ داد." } }, 500));
    const err = await failure(api("/api/staff", { method: "POST", body: { name: "زهرا" } }));
    expect(err.code).toBe("INTERNAL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the upload path", () => {
  it("reads the same reasons off a multipart refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "VALIDATION", message: "حجم فایل بیش از حد مجاز است", reason: "BODY_TOO_LARGE", ref: "r-8" } }, 413),
    );
    const err = await failure(apiUpload("/api/media/upload", new FormData()));
    expect(err.reason).toBe("BODY_TOO_LARGE");
    expect(err.ref).toBe("r-8");
    expect(err.status).toBe(413);
    expect(err.message).toContain("حجم فایل بیش از حد مجاز است");
    expect(err.message).toContain("کوتاه‌تر کنید");
  });

  it("turns a transport failure on an upload into the same shape", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await failure(apiUpload("/api/media/upload", new FormData()));
    expect(err.reason).toBe("NETWORK");
  });
});

describe("the revalidation event", () => {
  it("is dispatched on success only, never on a refusal", async () => {
    const dispatch = vi.fn<(event: CustomEvent<{ tags: string[] }>) => boolean>();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 1 } }, 200, { "x-revalidate": "catalog,products" }));
    await expect(api("/api/products", { method: "POST", body: {} })).resolves.toEqual({ id: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].detail.tags).toEqual(["catalog", "products"]);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: { code: "CONFLICT", message: "این عملیات در وضعیت فعلی ممکن نیست." } }, 409, { "x-revalidate": "catalog" }));
    await failure(api("/api/products", { method: "POST", body: {} }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
