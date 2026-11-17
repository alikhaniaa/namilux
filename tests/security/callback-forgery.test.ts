import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, eq, jobs as jobsTable, orders, payments, securityEvents } from "@namilux/db";
import { DEFAULT_SETTINGS, handleCallback, resultRedirect, ulid } from "@namilux/core";
import type { PaymentDriver } from "@namilux/core";

const BASE = (process.env["E2E_BASE_URL"] ?? "").replace(/\/$/, "");

function driver(verify: PaymentDriver["verify"]): PaymentDriver {
  return {
    key: "mock",
    async request() {
      return { ok: false, error: "n/a" };
    },
    verify,
  };
}

describe.skipIf(!hasTestDb())("callback forgery — core", () => {
  let handle: TestDb;
  let seq = 0;
  beforeAll(async () => {
    handle = await createTestDb();
    await truncateAll(handle.db);
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function pendingOrder(grandTotal: number): Promise<{ id: string; code: string; authority: string }> {
    const id = ulid();
    const code = `NL-${ulid().slice(-5)}`;
    const customerId = ulid();
    seq += 1;
    await handle.db.insert(customers).values({ id: customerId, phone: `0917${String(1_000_000 + seq).slice(-7)}`, referralCode: ulid().slice(-8) });
    await handle.db.insert(orders).values({ id, code, phone: "09121110000", customerId, status: "pending_payment", subtotal: grandTotal, grandTotal, placedAt: new Date() });
    const authority = `AUTH-${ulid().slice(-8)}`;
    await handle.db.insert(payments).values({ id: ulid(), orderId: id, driver: "mock", amount: grandTotal, status: "redirected", authority });
    return { id, code, authority };
  }

  const ctx = (d: PaymentDriver) => ({ drivers: { payment: () => d }, settings: DEFAULT_SETTINGS, ip: "203.0.113.5" });

  it("unknown authority → generic failure redirect", async () => {
    const verify: PaymentDriver["verify"] = async () => ({ ok: true, refId: "REF", alreadyVerified: false });
    const r = await handleCallback(handle.db, "mock", { Authority: "FORGED-000", Status: "OK" }, ctx(driver(verify)));
    expect(r.ok).toBe(false);
    expect(r.orderCode).toBe("");
    const url = resultRedirect(r, "https://namilux.ir");
    expect(url).toContain("/billing/result/");
    expect(url).toContain("s=fail");
    expect(url).not.toMatch(/NL-[A-Z0-9]{5}/);
    expect(JSON.stringify(await handle.db.select().from(securityEvents))).toContain("callback.forged");
  });

  it("Status=OK without verify success never marks paid", async () => {
    const o = await pendingOrder(41_500_000);
    const verify: PaymentDriver["verify"] = async () => ({ ok: false, error: "verify says no" });
    const r = await handleCallback(handle.db, "mock", { Authority: o.authority, Status: "OK" }, ctx(driver(verify)));
    expect(r.ok).toBe(false);
    const row = (await handle.db.select().from(orders).where(eq(orders.id, o.id)))[0];
    expect(row?.status).not.toBe("paid");
    expect(row?.paidAt).toBeNull();
    const paidSms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "order.paid");
    expect(paidSms).toHaveLength(0);
  });

  it("replayed callback does not double-notify", async () => {
    const o = await pendingOrder(41_500_000);
    let calls = 0;
    const verify: PaymentDriver["verify"] = async () => {
      calls += 1;
      return calls === 1 ? { ok: true, refId: "REF-1", alreadyVerified: false } : { ok: true, refId: "REF-1", alreadyVerified: true };
    };
    const first = await handleCallback(handle.db, "mock", { Authority: o.authority, Status: "OK" }, ctx(driver(verify)));
    expect(first.ok).toBe(true);
    expect(first.orderCode).toBe(o.code);
    const replay = await handleCallback(handle.db, "mock", { Authority: o.authority, Status: "OK" }, ctx(driver(verify)));
    expect(replay.orderCode).toBe(o.code);
    const row = (await handle.db.select().from(orders).where(eq(orders.id, o.id)))[0];
    expect(row?.status).toBe("paid");
    const paidSms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "order.paid" && j.payloadJson["orderId"] === o.id);
    expect(paidSms).toHaveLength(1);
    const paidTg = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "telegram.notify" && j.payloadJson["orderId"] === o.id && j.payloadJson["event"] === "order.paid");
    expect(paidTg).toHaveLength(1);
  });
});

describe.skipIf(BASE === "")("callback forgery — live", () => {
  it("unknown authority → generic failure redirect", async () => {
    const res = await fetch(`${BASE}/api/payment/callback/mock/?Authority=FORGED-LIVE&Status=OK`, { redirect: "manual" });
    expect([302, 303, 307]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/billing/result/");
    expect(location).toContain("s=fail");
    expect(location).not.toMatch(/NL-[A-Z0-9]{5}/);
  });
});
