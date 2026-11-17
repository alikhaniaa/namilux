import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_PERMISSIONS, permissionsForRole, signSudoToken } from "@namilux/core";
import type { Permission, StaffUser } from "@namilux/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route guards, exercised for real: the handler each route exports is called with a staff member of
 * a given role and the response is checked. A hidden menu is never the protection - these are the
 * server checks behind it.
 *
 * The mocks below replace exactly two things: the session (so the test decides who is asking) and
 * the database handle (so nothing connects). Every authorisation decision is the real one.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  env: {
    ADMIN_ORIGIN: "https://admin.namilux.ir",
    SITE_ORIGIN: "https://namilux.ir",
    SESSION_PEPPER: "0".repeat(64),
    INTERNAL_SIGNING_KEY: "0".repeat(64),
    TRUST_PROXY: false,
    DATABASE_URL_ADMIN: "postgres://nl_admin:x@127.0.0.1:5432/namilux",
    MEDIA_DIR: "/tmp/media",
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

const currentStaff = vi.fn<() => Promise<StaffUser | null>>();
vi.mock("@/lib/session", () => ({
  currentStaff: () => currentStaff(),
  requireStaff: () => currentStaff(),
  serverIp: () => Promise.resolve("127.0.0.1"),
  staffCookie: () => ({}),
  clearStaffCookie: () => ({}),
  sudoCookie: () => ({}),
  clearSudoCookie: () => ({}),
}));
// The revalidate fan-out would try to reach the storefront over HTTP.
vi.mock("@/lib/revalidate-client", () => ({ send: () => Promise.resolve({ ok: true }) }));

// Core service functions the happy paths would otherwise run against a database. Only the data
// access is replaced - `can`, `assertCan`, every schema and every redaction helper stay real.
const listStaff = vi.fn<() => Promise<unknown>>();
const createStaff = vi.fn<() => Promise<unknown>>();
/**
 * `getProductAdmin` keeps its arguments so a test can prove WHICH product the update route judged
 * the payload against - the URL id, never a body id.
 */
const getProductAdmin = vi.fn<(db: unknown, id: number) => Promise<unknown>>();
/** `upsertProduct` keeps its arguments so a test can prove what was written, and with which id. */
const upsertProduct = vi.fn<(db: unknown, input: Record<string, unknown>, actor: unknown) => Promise<unknown>>(
  () => Promise.resolve({ id: 1, tags: [] }),
);
const getSettings = vi.fn<() => Promise<Record<string, unknown>>>();
const dashboard = vi.fn<() => Promise<unknown>>();
const savePriceSheet = vi.fn<(...args: unknown[]) => Promise<{ updated: number; tags: string[] }>>().mockResolvedValue({ updated: 1, tags: ["catalog"] });
const markProductUnavailable = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const markProductAvailable = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
vi.mock("@namilux/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const page = { items: [], total: 0, page: 1, pageSize: 50 };
  return {
    ...actual,
    listStaff: () => listStaff(),
    listStaffSessions: () => Promise.resolve([]),
    createStaff: () => createStaff(),
    updateStaff: () => Promise.resolve({ id: "x" }),
    deleteStaff: () => Promise.resolve(),
    resetStaffPassword: () => Promise.resolve({ password: "one-time-secret" }),
    getProductAdmin: (db: unknown, id: number) => getProductAdmin(db, id),
    upsertProduct: (db: unknown, input: Record<string, unknown>, actor: unknown) => upsertProduct(db, input, actor),
    getSettings: () => getSettings(),
    setSetting: () => Promise.resolve({ tags: [] }),
    dashboard: () => dashboard(),
    savePriceSheet: (...args: unknown[]) => savePriceSheet(...args),
    markProductUnavailable: (...args: unknown[]) => markProductUnavailable(...args),
    markProductAvailable: (...args: unknown[]) => markProductAvailable(...args),
    listPriceSheet: () => Promise.resolve([]),
    funnel: () => Promise.resolve([]),
    listOrders: () => Promise.resolve(page),
    listCoupons: () => Promise.resolve(page),
  };
});

const CSRF = "test-csrf-token";
const PEPPER = "0".repeat(64);
const SESSION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
/** A real sudo token for the fixture session - `staff.manage` and the other destructive
 *  permissions demand a fresh TOTP, and the test proves the permission, not the sudo prompt. */
const SUDO = signSudoToken(SESSION_ID, new Date(Date.now() + 300_000), PEPPER);

function staffOf(role: keyof typeof ROLE_PERMISSIONS, mustChangePassword = false): StaffUser {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    email: `${role}@namilux.ir`,
    name: role,
    role,
    permissions: [...permissionsForRole(role)],
    isActive: true,
    totpEnabled: true,
    sudoUntil: null,
    sessionId: SESSION_ID,
    mustChangePassword,
  };
}

/** A same-origin request that carries the CSRF pair every mutation needs, and a fresh sudo cookie. */
function req(method: string, url: string, body?: unknown): Request {
  const headers: Record<string, string> = {
    origin: "https://admin.namilux.ir",
    "sec-fetch-site": "same-origin",
    cookie: `nl_c=${CSRF}; nl_sudo=${SUDO}`,
    "x-nl-csrf": CSRF,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const noParams = { params: Promise.resolve<Record<string, string>>({}) };
const withParams = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

type Envelope = { ok?: boolean; data?: unknown; error?: { code: string; message: string } };
async function call(
  handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>,
  role: keyof typeof ROLE_PERMISSIONS,
  request: Request,
  ctx = noParams,
): Promise<{ status: number; body: Envelope }> {
  currentStaff.mockResolvedValue(staffOf(role));
  const res = await handler(request, ctx);
  return { status: res.status, body: (await res.json()) as Envelope };
}

beforeEach(() => {
  vi.clearAllMocks();
  listStaff.mockResolvedValue([]);
  // The product update route reads the stored row before it decides; a priced product is the norm.
  getProductAdmin.mockResolvedValue(structuredClone(PRODUCT_VIEW));
  getSettings.mockResolvedValue({ "store.info": { brandName: "نامی لوکس" }, "commerce.vat_percent": 10 });
  dashboard.mockResolvedValue({ revenue: { today: 1, d7: 2, d30: 3 } });
});

describe("mark product unavailable protections", () => {
  const url = "https://admin.namilux.ir/api/products/1/unavailable";
  it("allows an admin and rejects invalid ids or unrelated body fields", async () => {
    const route = await import("@/app/api/products/[id]/unavailable/route");
    expect((await call(route.PUT, "admin", req("PUT", url, {}), withParams({ id: "1" }))).status).toBe(200);
    expect(markProductUnavailable).toHaveBeenCalledOnce();
    expect((await call(route.PUT, "admin", req("PUT", url, {}), withParams({ id: "bad" }))).status).toBe(400);
    expect((await call(route.PUT, "admin", req("PUT", url, { price: 0 }), withParams({ id: "1" }))).status).toBe(400);
    expect(markProductUnavailable).toHaveBeenCalledOnce();
  });
  it("rejects unauthorized roles and missing CSRF before touching stock", async () => {
    const route = await import("@/app/api/products/[id]/unavailable/route");
    expect((await call(route.PUT, "viewer", req("PUT", url, {}), withParams({ id: "1" }))).status).toBe(403);
    const request = req("PUT", url, {});
    request.headers.delete("x-nl-csrf");
    expect((await call(route.PUT, "admin", request, withParams({ id: "1" }))).status).toBe(403);
    expect(markProductUnavailable).not.toHaveBeenCalled();
  });
});

describe("mark product available protections", () => {
  const url = "https://admin.namilux.ir/api/products/1/available";
  it("allows an admin with a whole quantity and rejects invalid ids, quantities or extra fields", async () => {
    const route = await import("@/app/api/products/[id]/available/route");
    expect((await call(route.PUT, "admin", req("PUT", url, { qty: 5 }), withParams({ id: "1" }))).status).toBe(200);
    expect(markProductAvailable).toHaveBeenCalledOnce();
    expect(markProductAvailable.mock.calls[0]?.slice(1, 3)).toEqual([1, 5]);
    expect((await call(route.PUT, "admin", req("PUT", url, { qty: 5 }), withParams({ id: "bad" }))).status).toBe(400);
    for (const body of [{}, { qty: 0 }, { qty: 1.5 }, { qty: "5" }, { qty: 10_001 }, { qty: 5, price: 0 }]) {
      expect((await call(route.PUT, "admin", req("PUT", url, body), withParams({ id: "1" }))).status).toBe(400);
    }
    expect(markProductAvailable).toHaveBeenCalledOnce();
  });
  it("rejects unauthorized roles and missing CSRF before touching stock", async () => {
    const route = await import("@/app/api/products/[id]/available/route");
    expect((await call(route.PUT, "viewer", req("PUT", url, { qty: 5 }), withParams({ id: "1" }))).status).toBe(403);
    const request = req("PUT", url, { qty: 5 });
    request.headers.delete("x-nl-csrf");
    expect((await call(route.PUT, "admin", request, withParams({ id: "1" }))).status).toBe(403);
    expect(markProductAvailable).not.toHaveBeenCalled();
  });
});

describe("price sheet save protections", () => {
  const url = "https://admin.namilux.ir/api/products/prices";
  const body = { rows: [{ id: 1, before: { price: 100, compareAtPrice: null }, after: { price: 200, compareAtPrice: null } }] };
  it("allows an everyday admin to save with fresh verification", async () => {
    const route = await import("@/app/api/products/prices/route");
    expect((await call(route.PUT, "admin", req("PUT", url, body))).status).toBe(200);
    expect(savePriceSheet).toHaveBeenCalledOnce();
  });
  it("blocks viewers, content staff and missing fresh verification", async () => {
    const route = await import("@/app/api/products/prices/route");
    for (const role of ["viewer", "content"] as const) expect((await call(route.PUT, role, req("PUT", url, body))).status).toBe(403);
    const request = req("PUT", url, body);
    request.headers.set("cookie", `nl_c=${CSRF}`);
    expect((await call(route.PUT, "admin", request)).status).toBe(403);
    expect(savePriceSheet).not.toHaveBeenCalled();
  });
  it("rejects CSRF failures and malformed prices before the service", async () => {
    const route = await import("@/app/api/products/prices/route");
    const request = req("PUT", url, body);
    request.headers.delete("x-nl-csrf");
    expect((await call(route.PUT, "admin", request)).status).toBe(403);
    expect((await call(route.PUT, "admin", req("PUT", url, { rows: [] }))).status).toBe(400);
    expect(savePriceSheet).not.toHaveBeenCalled();
  });
});

describe("hand price edit protections", () => {
  const url = "https://admin.namilux.ir/api/products/prices";
  const row = (id: number) => ({ id, before: { price: 100, compareAtPrice: null }, after: { price: 200, compareAtPrice: null } });
  /** The same request without the second-factor cookie: typing prices row by row never asks for a code. */
  function plain(body: unknown): Request {
    const request = req("PATCH", url, body);
    request.headers.set("cookie", `nl_c=${CSRF}`);
    return request;
  }
  it("saves a typed price with the pricing permission alone, no fresh verification", async () => {
    const route = await import("@/app/api/products/prices/route");
    expect(route.PATCH.permission).toBe("catalog.price");
    const res = await call(route.PATCH, "admin", plain({ rows: [row(1)] }));
    expect(res.status).toBe(200);
    expect(savePriceSheet).toHaveBeenCalledOnce();
  });
  it("still refuses staff who may not price, and a request without the CSRF pair", async () => {
    const route = await import("@/app/api/products/prices/route");
    for (const role of ["viewer", "content", "instalments"] as const) expect((await call(route.PATCH, role, plain({ rows: [row(1)] }))).status).toBe(403);
    const request = plain({ rows: [row(1)] });
    request.headers.delete("x-nl-csrf");
    expect((await call(route.PATCH, "admin", request)).status).toBe(403);
    expect(savePriceSheet).not.toHaveBeenCalled();
  });
  it("cannot stand in for the bulk save: more rows than a person types at once are refused", async () => {
    const route = await import("@/app/api/products/prices/route");
    const many = Array.from({ length: 26 }, (_, i) => row(i + 1));
    expect((await call(route.PATCH, "admin", plain({ rows: many }))).status).toBe(400);
    expect((await call(route.PATCH, "admin", plain({ rows: [] }))).status).toBe(400);
    expect((await call(route.PATCH, "admin", plain({ rows: [row(1), row(1)] }))).status).toBe(400);
    expect(savePriceSheet).not.toHaveBeenCalled();
    expect((await call(route.PATCH, "admin", plain({ rows: many.slice(0, 25) }))).status).toBe(200);
  });
});

// ── the audit: every route declares a permission ────────────────────────────────────────────────

const API_ROOT = fileURLToPath(new URL("../../app/api", import.meta.url));
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * The routes that are NOT `adminHandler`, because they run before or beside the staff session or
 * answer with something other than the JSON envelope. Each is listed with the check it makes
 * instead - the list IS the audit, and a new unguarded route fails this test until it is explained.
 */
const HAND_WRITTEN: Record<string, string> = {
  "auth/login/route.ts": "public: the login itself (rate-limited, same-origin)",
  "auth/logout/route.ts": "public: ends whatever session the cookie names",
  "auth/totp/route.ts": "public: TOTP verify + first-login enrolment, holds a signed temp token",
  "auth/sudo/route.ts": "any signed-in staff re-proving their TOTP",
  "account/password/route.ts": "any signed-in staff changing their OWN password (currentStaff + CSRF)",
  "account/sessions/route.ts": "any signed-in staff listing their OWN sessions",
  "account/totp/route.ts": "any signed-in staff re-enrolling their OWN authenticator",
  "media/upload/route.ts": "multipart, so not adminHandler — asserts media.write by hand",
  "staff/invite/route.ts": "public: accepting an invite with a signed token, before any session",
  "customers/export/route.ts": "streams a CSV, so not the JSON envelope — asserts customers.export + sudo by hand",
};

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

describe("every API route declares the permission it needs", () => {
  const files = routeFiles(API_ROOT);

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(70);
  });

  for (const file of files) {
    const rel = relative(API_ROOT, file).replaceAll("\\", "/");
    it(rel, async () => {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      const exported = VERBS.filter((v) => typeof mod[v] === "function");
      expect(exported.length, `${rel} exports no HTTP verb`).toBeGreaterThan(0);
      for (const verb of exported) {
        const handler = mod[verb] as { permission?: Permission };
        if (typeof handler.permission === "string") {
          expect(ROLE_PERMISSIONS.owner, `${rel} ${verb}`).toContain(handler.permission);
        } else {
          // Not an adminHandler: it must be one of the routes listed above, with its reason.
          expect(Object.keys(HAND_WRITTEN), `${rel} ${verb} has no permission and is not listed`).toContain(rel);
        }
      }
    });
  }
});

// ── staff management: the owner alone ───────────────────────────────────────────────────────────

describe("/api/staff - staff.manage", () => {
  it("explains a short initial password without exposing it or creating staff", async () => {
    const list = await import("@/app/api/staff/route");
    const r = await call(list.POST, "owner", req("POST", "https://admin.namilux.ir/api/staff", { email: "09120000000", name: "آزمایش", role: "admin", password: "short123" }));
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toContain("حداقل ۱۲ نویسه");
    expect(r.body.error).toMatchObject({ details: { fields: { password: r.body.error?.message } } });
    expect(JSON.stringify(r.body)).not.toContain("short123");
    expect(createStaff).not.toHaveBeenCalled();
  });

  it("accepts a 12-character initial password and still normalizes the phone", async () => {
    const list = await import("@/app/api/staff/route");
    createStaff.mockResolvedValue({ staff: { id: "s1", role: "admin" }, password: "LongEnough12" });
    const r = await call(list.POST, "owner", req("POST", "https://admin.namilux.ir/api/staff", { email: "۰۹۱۲۰۰۰۰۰۰۰", name: "آزمایش", role: "admin", password: "LongEnough12" }));
    expect(r.status).toBe(200);
    expect(createStaff).toHaveBeenCalledTimes(1);
  });
  it("an admin cannot list, create or change staff", async () => {
    const list = await import("@/app/api/staff/route");
    const one = await import("@/app/api/staff/[id]/route");
    expect((await call(list.GET, "admin", req("GET", "https://admin.namilux.ir/api/staff"))).status).toBe(403);
    expect(
      (await call(list.POST, "admin", req("POST", "https://admin.namilux.ir/api/staff", { email: "a@b.ir", name: "زهرا", role: "admin" }))).status,
    ).toBe(403);
    expect(
      (await call(one.PUT, "admin", req("PUT", "https://admin.namilux.ir/api/staff/x", { isActive: false }), withParams({ id: "x" }))).status,
    ).toBe(403);
    expect((await call(one.DELETE, "admin", req("DELETE", "https://admin.namilux.ir/api/staff/x?hard=1"), withParams({ id: "x" }))).status).toBe(403);
    expect(createStaff).not.toHaveBeenCalled();
  });

  it("no role but owner reaches it at all", async () => {
    const list = await import("@/app/api/staff/route");
    for (const role of ["manager", "orders", "content", "support", "viewer"] as const) {
      expect((await call(list.GET, role, req("GET", "https://admin.namilux.ir/api/staff"))).status, role).toBe(403);
    }
  });

  it("the owner lists staff, and creating one returns the one-time password once", async () => {
    const list = await import("@/app/api/staff/route");
    expect((await call(list.GET, "owner", req("GET", "https://admin.namilux.ir/api/staff"))).status).toBe(200);
    createStaff.mockResolvedValue({ staff: { id: "s1", role: "admin" }, password: "Xy7pQm2ntRk4Vb9sTdWf" });
    // A bare username is a valid identity, so the create schema accepts it and normalises it.
    const created = await call(list.POST, "owner", req("POST", "https://admin.namilux.ir/api/staff", { email: " Ali.Karimi ", name: "علی", role: "admin" }));
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({ password: "Xy7pQm2ntRk4Vb9sTdWf" });
    // The identity is normalised by the schema before the service ever sees it.
    expect(createStaff).toHaveBeenCalledTimes(1);
  });

  it("a strict body: an unknown key is a 400, not a silent drop", async () => {
    const list = await import("@/app/api/staff/route");
    const r = await call(list.POST, "owner", req("POST", "https://admin.namilux.ir/api/staff", { email: "a@b.ir", name: "زهرا", role: "admin", isActive: true }));
    expect(r.status).toBe(400);
  });
});

// ── analytics: sales and revenue are the owner's ────────────────────────────────────────────────

describe("/api/analytics - analytics.read", () => {
  it("is refused for every role but the owner", async () => {
    const mod = await import("@/app/api/analytics/route");
    for (const role of ["admin", "manager", "orders", "content", "support", "viewer"] as const) {
      const r = await call(mod.GET, role, req("GET", "https://admin.namilux.ir/api/analytics?range=7d"));
      expect(r.status, role).toBe(403);
      expect(JSON.stringify(r.body), role).not.toContain("revenue");
    }
    expect(dashboard).not.toHaveBeenCalled();
  });

  it("the owner gets the numbers", async () => {
    const mod = await import("@/app/api/analytics/route");
    const r = await call(mod.GET, "owner", req("GET", "https://admin.namilux.ir/api/analytics?range=7d"));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("revenue");
  });
});

// ── settings: the money groups vs the operational ones ──────────────────────────────────────────

describe("/api/settings - the money groups", () => {
  it("an admin may read and write an ordinary group", async () => {
    const mod = await import("@/app/api/settings/[group]/route");
    expect((await call(mod.GET, "admin", req("GET", "https://admin.namilux.ir/api/settings/store.info"), withParams({ group: "store.info" }))).status).toBe(200);
  });

  for (const group of ["commerce.vat_percent", "loyalty.rules"]) {
    it(`an admin may not read or write ${group}`, async () => {
      const mod = await import("@/app/api/settings/[group]/route");
      const read = await call(mod.GET, "admin", req("GET", `https://admin.namilux.ir/api/settings/${group}`), withParams({ group }));
      expect(read.status).toBe(403);
      const write = await call(mod.PUT, "admin", req("PUT", `https://admin.namilux.ir/api/settings/${group}`, { value: 25 }), withParams({ group }));
      expect(write.status).toBe(403);
    });

    it(`the owner may read ${group}`, async () => {
      const mod = await import("@/app/api/settings/[group]/route");
      const read = await call(mod.GET, "owner", req("GET", `https://admin.namilux.ir/api/settings/${group}`), withParams({ group }));
      expect(read.status).toBe(200);
    });
  }

  it("the whole-map read drops the money groups for an admin", async () => {
    const mod = await import("@/app/api/settings/route");
    const admin = await call(mod.GET, "admin", req("GET", "https://admin.namilux.ir/api/settings"));
    expect(admin.status).toBe(200);
    expect(Object.keys(admin.body.data as object)).not.toContain("commerce.vat_percent");
    const owner = await call(mod.GET, "owner", req("GET", "https://admin.namilux.ir/api/settings"));
    expect(Object.keys(owner.body.data as object)).toContain("commerce.vat_percent");
  });
});

// ── products: the cost price is a field, not a page ─────────────────────────────────────────────

const PRODUCT_VIEW = {
  row: { id: 7, displayName: "اجاق گاز", price: 12_000_000, costPrice: 9_000_000, basePrice: null, baseCurrency: null },
  full: { specs: [] },
  priceHistory: [],
  movements: [],
  reservations: [],
  availableQty: 3,
  siblings: [],
};

const PRODUCT_BODY = {
  slug: "gas-hob",
  name: "اجاق گاز",
  displayName: "اجاق گاز",
  status: "draft",
  visibility: "public",
  price: 12_000_000,
  priceBasis: "manual",
  stockPolicy: "track",
  allowBackorder: false,
  lowStockThreshold: 3,
  maxPerOrder: 5,
  shortHtml: "",
  descriptionHtml: "",
};

describe("/api/products - the cost price never leaves for a non-owner", () => {
  it("the read strips it for an admin and keeps it for the owner", async () => {
    const mod = await import("@/app/api/products/[id]/route");
    getProductAdmin.mockResolvedValue(structuredClone(PRODUCT_VIEW));
    const admin = await call(mod.GET, "admin", req("GET", "https://admin.namilux.ir/api/products/7"), withParams({ id: "7" }));
    expect(admin.status).toBe(200);
    expect(JSON.stringify(admin.body)).not.toContain("9000000");

    getProductAdmin.mockResolvedValue(structuredClone(PRODUCT_VIEW));
    const owner = await call(mod.GET, "owner", req("GET", "https://admin.namilux.ir/api/products/7"), withParams({ id: "7" }));
    expect(JSON.stringify(owner.body)).toContain("9000000");
  });

  it("the write refuses a costPrice from an admin and takes one from the owner", async () => {
    const one = await import("@/app/api/products/[id]/route");
    const many = await import("@/app/api/products/route");
    const withCost = { ...PRODUCT_BODY, costPrice: 9_000_000 };

    const put = await call(one.PUT, "admin", req("PUT", "https://admin.namilux.ir/api/products/7", withCost), withParams({ id: "7" }));
    expect(put.status).toBe(403);
    const post = await call(many.POST, "admin", req("POST", "https://admin.namilux.ir/api/products", withCost));
    expect(post.status).toBe(403);

    // …and the same body without the key is accepted, which is what the admin's form actually sends.
    const ok = await call(one.PUT, "admin", req("PUT", "https://admin.namilux.ir/api/products/7", PRODUCT_BODY), withParams({ id: "7" }));
    expect(ok.status).toBe(200);
    expect((await call(one.PUT, "owner", req("PUT", "https://admin.namilux.ir/api/products/7", withCost), withParams({ id: "7" }))).status).toBe(200);
  });
});

// ── products: the selling price is a permission, not a page ─────────────────────────────────────

/**
 * The stored row the price tests judge against: priced, no sale price, instalment DERIVED (not
 * pinned), eligible, manual basis. `getProductAdmin` answers for the id the route asks for, which
 * is what lets a test prove the URL id - not a body id - chose the baseline.
 */
const PRICE_ROW = {
  ...PRODUCT_VIEW.row,
  compareAtPrice: null,
  instalmentPrice: null,
  instalmentPriceManual: false,
  instalmentEligible: true,
  priceBasis: "manual",
};

const adminView = (row: Record<string, unknown> = {}) => ({
  ...structuredClone(PRODUCT_VIEW),
  row: { ...structuredClone(PRICE_ROW), ...structuredClone(row) },
});

/** What the product form sends back for PRICE_ROW, with a text edit on top: no price value moves. */
const UNCHANGED_PRICE_BODY = { ...PRODUCT_BODY, displayName: "اجاق گاز رومیزی", shortHtml: "<p>توضیح تازه</p>" };

describe("/api/products - pricing needs catalog.price, editing text does not", () => {
  const URL7 = "https://admin.namilux.ir/api/products/7";
  const URL = "https://admin.namilux.ir/api/products";
  /** The refusal the guard itself writes - `catalog.write`'s generic one does not name a price. */
  const PRICE_REFUSAL = "قیمت";

  it("a content editor cannot create a priced product", async () => {
    const many = await import("@/app/api/products/route");
    const bodies: Record<string, unknown>[] = [
      { ...PRODUCT_BODY, price: 12_000_000 },
      { ...PRODUCT_BODY, compareAtPrice: 15_000_000 },
      { ...PRODUCT_BODY, price: 0, instalmentPriceManual: true, instalmentPrice: 13_000_000 },
      { ...PRODUCT_BODY, priceBasis: "fx", basePrice: 380, baseCurrency: "EUR" },
      { ...PRODUCT_BODY, price: 0, instalmentEligible: false },
    ];
    for (const body of bodies) {
      const r = await call(many.POST, "content", req("POST", URL, body));
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect(r.body.error?.code, JSON.stringify(body)).toBe("FORBIDDEN");
      expect(r.body.error?.message, JSON.stringify(body)).toContain(PRICE_REFUSAL);
    }
    expect(upsertProduct).not.toHaveBeenCalled();
  });

  it("a content editor may still create an unpriced product", async () => {
    const many = await import("@/app/api/products/route");
    const r = await call(many.POST, "content", req("POST", URL, { ...PRODUCT_BODY, price: 0 }));
    expect(r.status).toBe(200);
    expect(upsertProduct).toHaveBeenCalledTimes(1);
  });

  it("a content editor cannot move any commercial value on an existing product", async () => {
    const one = await import("@/app/api/products/[id]/route");
    getProductAdmin.mockResolvedValue(adminView());
    const bodies: Record<string, unknown>[] = [
      { ...PRODUCT_BODY, price: 13_000_000 },
      { ...PRODUCT_BODY, price: 0 }, // «استعلامی» is a price state too - it clears the fixed price.
      { ...PRODUCT_BODY, compareAtPrice: 15_000_000 },
      { ...PRODUCT_BODY, instalmentPriceManual: true, instalmentPrice: 13_000_000 },
      { ...PRODUCT_BODY, priceBasis: "fx", basePrice: 380, baseCurrency: "EUR" },
      { ...PRODUCT_BODY, instalmentEligible: false },
    ];
    for (const body of bodies) {
      const r = await call(one.PUT, "content", req("PUT", URL7, body), withParams({ id: "7" }));
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect(r.body.error?.message, JSON.stringify(body)).toContain(PRICE_REFUSAL);
    }
    expect(upsertProduct).not.toHaveBeenCalled();
  });

  it("a content editor still saves text and images while the price values stay put", async () => {
    const one = await import("@/app/api/products/[id]/route");
    getProductAdmin.mockResolvedValue(adminView());
    const r = await call(one.PUT, "content", req("PUT", URL7, UNCHANGED_PRICE_BODY), withParams({ id: "7" }));
    expect(r.status).toBe(200);
    expect(upsertProduct.mock.calls[0]?.[1]).toMatchObject({ id: 7, price: 12_000_000, displayName: "اجاق گاز رومیزی" });
  });

  it("the price permission passes exactly the payloads the content editor cannot", async () => {
    const one = await import("@/app/api/products/[id]/route");
    const many = await import("@/app/api/products/route");
    getProductAdmin.mockResolvedValue(adminView());
    // `admin` holds catalog.price but not catalog.cost - the pricing role without the owner's money.
    for (const body of [
      { ...PRODUCT_BODY, price: 13_000_000 },
      { ...PRODUCT_BODY, compareAtPrice: 15_000_000 },
      { ...PRODUCT_BODY, instalmentEligible: false },
    ]) {
      const r = await call(one.PUT, "admin", req("PUT", URL7, body), withParams({ id: "7" }));
      expect(r.status, JSON.stringify(body)).toBe(200);
    }
    expect((await call(many.POST, "admin", req("POST", URL, PRODUCT_BODY))).status).toBe(200);
  });

  it("absent optional keys never move a protected value by accident", async () => {
    const one = await import("@/app/api/products/[id]/route");
    // Pinned instalment price, ineligible, on sale, FX basis: every optional key carries a value.
    getProductAdmin.mockResolvedValue(
      adminView({
        price: 12_000_000,
        compareAtPrice: 15_000_000,
        instalmentPriceManual: true,
        instalmentPrice: 14_000_000,
        instalmentEligible: false,
        priceBasis: "fx",
        basePrice: 380,
        baseCurrency: "EUR",
      }),
    );
    const pinned: Record<string, unknown> = {
      ...PRODUCT_BODY,
      compareAtPrice: 15_000_000,
      instalmentPriceManual: true,
      instalmentPrice: 14_000_000,
      priceBasis: "fx",
      basePrice: 380,
      baseCurrency: "EUR",
    };

    // `instalmentEligible` is ABSENT: the write preserves the stored value, so the edit stands.
    expect((await call(one.PUT, "content", req("PUT", URL7, pinned), withParams({ id: "7" }))).status).toBe(200);
    // …and spelling out the stored value is not a change either: the values are compared.
    expect(
      (await call(one.PUT, "content", req("PUT", URL7, { ...pinned, instalmentEligible: false }), withParams({ id: "7" }))).status,
    ).toBe(200);

    // The same body WITHOUT the pinned instalment price would be stored as 0, not left alone.
    const { instalmentPrice: _pinnedPrice, ...withoutInstalmentPrice } = pinned;
    expect((await call(one.PUT, "content", req("PUT", URL7, withoutInstalmentPrice), withParams({ id: "7" }))).status).toBe(403);

    // An absent `compareAtPrice` clears the stored sale price, so it is refused too.
    const { compareAtPrice: _sale, ...withoutSale } = pinned;
    expect((await call(one.PUT, "content", req("PUT", URL7, withoutSale), withParams({ id: "7" }))).status).toBe(403);
  });

  it("a body id on POST cannot make a priced create look unchanged", async () => {
    const many = await import("@/app/api/products/route");
    getProductAdmin.mockResolvedValue(adminView());
    // Product 7 is priced at 12,000,000; a create carrying that price is still a priced create.
    const spoofed = await call(many.POST, "content", req("POST", URL, { ...PRODUCT_BODY, id: 7 }));
    expect(spoofed.status).toBe(403);
    // The create path reads no stored row at all - a body id never chooses the baseline.
    expect(getProductAdmin).not.toHaveBeenCalled();
    expect(upsertProduct).not.toHaveBeenCalled();

    // A neutral create with the same id is allowed, and it is still a CREATE: the id never reaches
    // the write, so it cannot update (or zero) product 7 behind the guard's back.
    const neutral = await call(many.POST, "content", req("POST", URL, { ...PRODUCT_BODY, id: 7, price: 0 }));
    expect(neutral.status).toBe(200);
    expect(upsertProduct.mock.calls[0]?.[1]).not.toHaveProperty("id");
  });

  it("the URL id, never the body id, is the row an update is judged against", async () => {
    const one = await import("@/app/api/products/[id]/route");
    getProductAdmin.mockImplementation((_db, id) => Promise.resolve(adminView({ price: id === 7 ? 12_000_000 : 13_000_000 })));

    // The body claims product 9 and carries 9's price; product 7 is still 12,000,000, so it moves - 
    // a comparison against the body id would have called this unchanged.
    const spoofed = await call(one.PUT, "content", req("PUT", URL7, { ...PRODUCT_BODY, id: 9, price: 13_000_000 }), withParams({ id: "7" }));
    expect(spoofed.status).toBe(403);
    expect(getProductAdmin.mock.calls[0]?.[1]).toBe(7);

    // …and the same body carrying 7's price is an ordinary edit, written to the URL id.
    const ok = await call(one.PUT, "content", req("PUT", URL7, { ...PRODUCT_BODY, id: 9, price: 12_000_000 }), withParams({ id: "7" }));
    expect(ok.status).toBe(200);
    expect(upsertProduct.mock.calls[0]?.[1]).toMatchObject({ id: 7, price: 12_000_000 });
  });
});

// ── /system and the audit log ───────────────────────────────────────────────────────────────────

describe("the infrastructure screens are owner-only", () => {
  it("an admin reaches neither the job queue, the SMS log, the audit log nor the cache", async () => {
    const jobs = await import("@/app/api/jobs/route");
    const smsLog = await import("@/app/api/sms-log/route");
    const audit = await import("@/app/api/audit/route");
    const cache = await import("@/app/api/cache/revalidate/route");
    expect((await call(jobs.GET, "admin", req("GET", "https://admin.namilux.ir/api/jobs"))).status).toBe(403);
    expect((await call(smsLog.GET, "admin", req("GET", "https://admin.namilux.ir/api/sms-log"))).status).toBe(403);
    expect((await call(audit.GET, "admin", req("GET", "https://admin.namilux.ir/api/audit"))).status).toBe(403);
    expect((await call(cache.POST, "admin", req("POST", "https://admin.namilux.ir/api/cache/revalidate", { tags: ["catalog"] }))).status).toBe(403);
  });

  it("an admin still runs the shop: orders, coupons, content, SMS broadcasts", async () => {
    const orders = await import("@/app/api/orders/route");
    const coupons = await import("@/app/api/coupons/route");
    // A 403 would mean the permission was refused; anything else means the guard let it through.
    for (const [name, handler] of [
      ["orders", orders.GET],
      ["coupons", coupons.GET],
    ] as const) {
      const r = await call(handler, "admin", req("GET", `https://admin.namilux.ir/api/${name}`));
      expect(r.body.error?.code, name).not.toBe("FORBIDDEN");
    }
  });
});


// ── the forced first-login password change ──────────────────────────────────────────────────────

/**
 * A one-time password is good for exactly one login. The admin shell redirects such an account to
 * /login/change-password, and `adminHandler` refuses every route behind it - otherwise the block
 * would be a redirect a hand-made request could simply skip. Only /api/account/password and the
 * logout stay open, and neither is an `adminHandler`.
 */
describe("must_change_password blocks every API route until the password is changed", () => {
  async function callMustChange(
    handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>,
    request: Request,
    ctx = noParams,
  ): Promise<{ status: number; body: Envelope }> {
    currentStaff.mockResolvedValue(staffOf("owner", true));
    const res = await handler(request, ctx);
    return { status: res.status, body: (await res.json()) as Envelope };
  }

  it("refuses reads and writes for the owner herself, with a Persian reason", async () => {
    const products = await import("@/app/api/products/route");
    const orders = await import("@/app/api/orders/route");
    const settings = await import("@/app/api/settings/route");

    for (const [name, handler] of [
      ["products", products.GET],
      ["orders", orders.GET],
      ["settings", settings.GET],
    ] as const) {
      const r = await callMustChange(handler, req("GET", `https://admin.namilux.ir/api/${name}`));
      expect(r.status, name).toBe(403);
      expect(r.body.error?.message, name).toContain("گذرواژه");
    }

    const write = await callMustChange(
      products.POST,
      req("POST", "https://admin.namilux.ir/api/products", PRODUCT_BODY),
    );
    expect(write.status).toBe(403);
  });

  it("lets the same account through once the flag is cleared", async () => {
    const products = await import("@/app/api/products/route");
    const r = await call(products.GET, "owner", req("GET", "https://admin.namilux.ir/api/products"));
    expect(r.body.error?.code).not.toBe("FORBIDDEN");
  });
});
