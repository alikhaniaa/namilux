import { AppError, ERROR_FA, appError } from "@namilux/core";
import type { StaffUser } from "@namilux/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The refusals `adminHandler` writes, exercised for real: reason codes, request refs, and the proof
 * that nothing the caller sent, no Zod default and no stack travels back with them.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  env: {
    ADMIN_ORIGIN: "https://admin.namilux.ir",
    SITE_ORIGIN: "https://namilux.ir",
    SESSION_PEPPER: "0".repeat(64),
    INTERNAL_SIGNING_KEY: "0".repeat(64),
    TRUST_PROXY: false,
  },
}));

const currentStaff = vi.fn<() => Promise<StaffUser | null>>();
vi.mock("@/lib/session", () => ({
  currentStaff: () => currentStaff(),
  requireStaff: () => currentStaff(),
  serverIp: () => Promise.resolve("127.0.0.1"),
}));
vi.mock("@/lib/revalidate-client", () => ({ send: () => Promise.resolve({ ok: true }) }));

const { adminHandler } = await import("../http-handler");

const CSRF = "test-csrf-token";
const ORIGIN = "https://admin.namilux.ir";

function staffOf(role: "owner" | "viewer", mustChangePassword = false): StaffUser {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    email: `${role}@namilux.ir`,
    name: role,
    role,
    permissions: role === "owner" ? ["catalog.write", "staff.manage"] : [],
    isActive: true,
    totpEnabled: true,
    sudoUntil: null,
    sessionId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
    mustChangePassword,
  };
}

type ErrorBody = {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; ref?: string; reason?: string; details?: unknown };
};

function req(method: string, body?: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/thing`, {
    method,
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", cookie: `nl_c=${CSRF}`, "x-nl-csrf": CSRF, ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

const ctx = { params: Promise.resolve<Record<string, string>>({}) };

async function call(
  handler: ReturnType<typeof adminHandler>,
  request: Request,
): Promise<{ status: number; headers: Headers; body: ErrorBody }> {
  const res = await handler(request, ctx);
  return { status: res.status, headers: res.headers, body: (await res.json()) as ErrorBody };
}

const schema = z
  .object({
    price: z.number().int().min(0),
    displayName: z.string().min(2).max(80),
  })
  .strict();

const echo = adminHandler({
  schema,
  permission: "catalog.write",
  sudo: false,
  run: (c) => Promise.resolve({ input: c.input }),
});

beforeEach(() => {
  vi.clearAllMocks();
  currentStaff.mockResolvedValue(staffOf("owner"));
});

describe("an authenticated write that fails validation", () => {
  it("names the reason, keeps the ref and translates the field errors", async () => {
    const r = await call(echo, req("POST", JSON.stringify({ price: "SECRET-VALUE", displayName: "x" }), { "x-request-id": "req-42" }));

    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("VALIDATION");
    expect(r.body.error?.reason).toBe("FIELD_VALIDATION");
    expect(r.body.error?.ref).toBe("req-42");
    expect(r.headers.get("x-request-id")).toBe("req-42");
    expect(r.body.error?.message).toContain("فیلد");

    const details = r.body.error?.details as { fieldErrors?: { path: string; message: string; label?: string }[] };
    expect(details.fieldErrors?.map((f) => f.path)).toEqual(["price", "displayName"]);
    expect(details.fieldErrors?.[0]?.label).toBe("قیمت");
    expect(details.fieldErrors?.[0]?.message).toBe("مقدار این فیلد باید عدد باشد");
    expect(details.fieldErrors?.[1]?.message).toBe("تعداد نویسه‌ها باید دست‌کم ۲ باشد");

    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain("SECRET-VALUE");
    expect(raw).not.toContain("Invalid input");
    expect(raw).not.toContain("expected");
  });

  it("tells a missing field from a wrong-typed one, and replaces a request id that is not id-shaped", async () => {
    const r = await call(echo, req("POST", JSON.stringify({ price: "SECRET-VALUE" }), { "x-request-id": "<script>SECRET</script>" }));
    const details = r.body.error?.details as { fieldErrors?: { path: string; message: string }[] };
    expect(details.fieldErrors?.find((f) => f.path === "price")?.message).toBe("مقدار این فیلد باید عدد باشد");
    expect(details.fieldErrors?.find((f) => f.path === "displayName")?.message).toBe("این فیلد لازم است");
    expect(r.body.error?.ref).toMatch(/^[0-9A-Z]{26}$/);
    expect(r.headers.get("x-request-id")).toBe(r.body.error?.ref);
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
  });

  it("drops a schema message that repeats a value the caller sent", async () => {
    const refined = adminHandler({
      schema: z.object({ slug: z.string() }).superRefine((value, ctx) => {
        ctx.addIssue({ code: "custom", path: ["slug"], message: `مقدار ${value.slug} تکراری است` });
      }),
      permission: "catalog.write",
      run: () => Promise.resolve({}),
    });

    const r = await call(refined, req("POST", JSON.stringify({ slug: "SECRET-SLUG-123" })));
    expect(r.status).toBe(400);
    expect(r.body.error?.reason).toBe("FIELD_VALIDATION");
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain("SECRET-SLUG-123");
    const details = r.body.error?.details as { fieldErrors?: { message: string }[] };
    expect(details.fieldErrors?.[0]?.message).toBe("مقدار این فیلد پذیرفته نشد");
  });

  it("rejects an invalid JSON body by name, without quoting it", async () => {
    const r = await call(echo, req("POST", "{not json"));
    expect(r.status).toBe(400);
    expect(r.body.error?.reason).toBe("INVALID_JSON");
    expect(r.body.error?.ref).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain("not json");
  });

  it("names an oversized body", async () => {
    const tiny = adminHandler({ permission: "catalog.write", bodyCap: 16, run: () => Promise.resolve({}) });
    const r = await call(tiny, req("POST", JSON.stringify({ displayName: "a".repeat(64) })));
    expect(r.status).toBe(413);
    expect(r.body.error?.reason).toBe("BODY_TOO_LARGE");
    expect(r.body.error?.ref).toBeTruthy();
  });
});

describe("the guards in front of a write", () => {
  it("tells an expired CSRF pair apart from a bad origin", async () => {
    const noCsrf = await call(echo, req("POST", "{}", { "x-nl-csrf": "" }));
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error?.reason).toBe("CSRF_EXPIRED");
    expect(noCsrf.body.error?.ref).toBeTruthy();
    expect(noCsrf.body.error?.message).not.toBe("درخواست نامعتبر است");

    const crossSite = await call(echo, req("POST", "{}", { origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    expect(crossSite.body.error?.reason).toBe("ORIGIN_REJECTED");
    expect(crossSite.body.error?.ref).toBeTruthy();
  });

  it("names a missing session and a forced password change", async () => {
    currentStaff.mockResolvedValue(null);
    const anonymous = await call(echo, req("POST", "{}"));
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error?.code).toBe("UNAUTHORIZED");
    expect(anonymous.body.error?.reason).toBe("SESSION_REQUIRED");
    expect(anonymous.body.error?.ref).toBeTruthy();

    currentStaff.mockResolvedValue(staffOf("owner", true));
    const mustChange = await call(echo, req("POST", "{}"));
    expect(mustChange.status).toBe(403);
    expect(mustChange.body.error?.reason).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(mustChange.body.error?.message).toContain("گذرواژه");
  });

  it("names a permission refusal without repeating the staff record", async () => {
    currentStaff.mockResolvedValue(staffOf("viewer"));
    const r = await call(echo, req("POST", "{}"));
    expect(r.status).toBe(403);
    expect(r.body.error?.reason).toBe("PERMISSION_DENIED");
    expect(r.body.error?.ref).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain("viewer@namilux.ir");
  });

  it("keeps the sudo contract: reason plus the details the dialog reads", async () => {
    const sudoOnly = adminHandler({ permission: "catalog.write", sudo: true, run: () => Promise.resolve({}) });
    const r = await call(sudoOnly, req("POST", "{}"));
    expect(r.status).toBe(403);
    expect(r.body.error?.reason).toBe("SUDO_REQUIRED");
    expect(r.body.error?.details).toMatchObject({ sudoRequired: true });
  });
});

describe("fail() keeps the existing envelope", () => {
  it("passes an app error's details through untouched, object or array", async () => {
    const objectDetails = adminHandler({
      permission: "catalog.write",
      run: () => Promise.reject(appError("VALIDATION", { details: { field: "id" } })),
    });
    const one = await call(objectDetails, req("POST", "{}"));
    expect(one.status).toBe(400);
    expect(one.body.error?.reason).toBe("VALIDATION");
    expect(one.body.error?.details).toEqual({ field: "id" });

    const issues = [{ path: "lines.0.qty", message: "مقدار معتبر نیست." }];
    const arrayDetails = adminHandler({
      permission: "catalog.write",
      run: () => Promise.reject(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION, issues)),
    });
    const many = await call(arrayDetails, req("POST", "{}"));
    expect(many.body.error?.details).toEqual(issues);
  });

  it("keeps an unexpected failure to INTERNAL + ref, with no stack, message or SQL", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exploding = adminHandler({
      permission: "catalog.write",
      run: () => Promise.reject(new Error("select * from staff where token = 'secret'")),
    });
    const r = await call(exploding, req("POST", "{}"));
    expect(r.status).toBe(500);
    expect(r.body.error?.code).toBe("INTERNAL");
    expect(r.body.error?.reason).toBe("INTERNAL");
    expect(r.body.error?.ref).toBeTruthy();
    expect(r.body.error?.message).toBe(ERROR_FA.INTERNAL);
    expect(JSON.stringify(r.body)).not.toContain("select");
    expect(JSON.stringify(r.body)).not.toContain("stack");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("still answers a success with the plain envelope and the revalidate tag", async () => {
    const saving = adminHandler({
      schema,
      permission: "catalog.write",
      run: () => Promise.resolve({ id: 7, revalidate: ["catalog"] }),
    });
    const r = await call(saving, req("POST", JSON.stringify({ price: 1, displayName: "کالا" }), { "x-request-id": "req-7" }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, data: { id: 7 } });
    expect(r.headers.get("x-revalidate")).toBe("catalog");
    expect(r.headers.get("x-request-id")).toBe("req-7");
  });
});
