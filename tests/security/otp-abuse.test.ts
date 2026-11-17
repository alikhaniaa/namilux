import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, jobs as jobsTable, securityEvents, settings } from "@namilux/db";
import { DEFAULT_OTP_LIMITS, configureOtp, getSetting, invalidateSettingsCache, requestOtp, ulid, verifyOtp } from "@namilux/core";

const IP = "203.0.113.7";
const UA = "ua-hash-test";
const LIMITS = {
  ...DEFAULT_OTP_LIMITS,
  cooldownSec: 0, // let the tests send repeatedly without waiting out the resend window
  phonePer10m: 100,
  phonePerDay: 100,
  ipPer10m: 100,
  uaPerDay: 100,
  captchaAfter: 3,
  global10m: 8,
  pauseMultiplier: 2,
};

describe.skipIf(!hasTestDb())("otp abuse", () => {
  let handle: TestDb;
  let lastCode = "";
  let sends = 0;
  let seq = 0;
  const phone = (): string => `0919${String(1_000_000 + (seq += 1)).slice(-7)}`;

  beforeAll(async () => {
    process.env.OTP_PEPPER = process.env.OTP_PEPPER ?? "a".repeat(64);
    handle = await createTestDb();
    await truncateAll(handle.db);
    await handle.db.insert(settings).values({ key: "otp.limits", valueJson: LIMITS }).onConflictDoUpdate({ target: settings.key, set: { valueJson: LIMITS } });
    invalidateSettingsCache();
    expect(await getSetting(handle.db, "otp.limits")).toEqual(LIMITS);
    configureOtp({
      send: async ({ code }) => {
        sends += 1;
        lastCode = code;
        return { ok: true, providerRef: "test" };
      },
      verifyPow: async () => true,
    });
  });
  afterAll(async () => {
    await truncateAll(handle.db);
    await handle.close();
  });

  it("4th send in 10 min for one phone → captcha required", async () => {
    // captchaAfter applies to every counter (phone, ip/24, ua and the global one) - this case runs first, on fresh counters
    // Keep rapid requests on one database timestamp and assert every intended send below,
    // so cooldown handling cannot silently weaken the quota threshold being tested.
    await handle.db.transaction(async (tx) => {
      const p = phone();
      const ip = "203.0.113.40";
      const ua = "ua-captcha-case";
      const before = sends;
      for (let i = 0; i < 3; i += 1) {
        const r = await requestOtp(tx, { phone: p, purpose: "login", ip, uaHash: ua });
        expect(r.captchaRequired).toBe(false);
        expect(r.resendAfterSec).toBe(0);
        expect(sends).toBe(before + i + 1);
      }
      const fourth = await requestOtp(tx, { phone: p, purpose: "login", ip, uaHash: ua });
      expect(fourth.captchaRequired).toBe(true);
      expect(sends).toBe(before + 3);
      // with a solved PoW the send goes through again
      const solved = await requestOtp(tx, { phone: p, purpose: "login", ip, uaHash: ua, powToken: "solved" });
      expect(solved.captchaRequired).toBe(false);
      expect(sends).toBe(before + 4);
    });
  });

  it("response identical for a known and an unknown phone", async () => {
    // Same database clock for both expiry timestamps; solved PoW exercises actual sends even
    // after the preceding abuse case has raised the global captcha counter.
    await handle.db.transaction(async (tx) => {
      const known = phone();
      await tx.insert(customers).values({ id: ulid(), phone: known, referralCode: ulid().slice(-8) });
      const a = await requestOtp(tx, { phone: known, purpose: "login", ip: IP, uaHash: UA, powToken: "solved" });
      const b = await requestOtp(tx, { phone: phone(), purpose: "login", ip: IP, uaHash: UA, powToken: "solved" });
      expect(a).toEqual(b);
      expect(a.captchaRequired).toBe(false);
      expect(a.expiresAt).toEqual(expect.any(String));
      expect(Object.keys(a).sort()).toEqual(["captchaRequired", "expiresAt", "resendAfterSec"]);
    });
  });

  it("5 wrong codes burn the code", async () => {
    const p = phone();
    const sent = await requestOtp(handle.db, { phone: p, purpose: "login", ip: "203.0.113.9", uaHash: "ua-burn-case", powToken: "solved" });
    expect(sent.captchaRequired).toBe(false);
    const right = lastCode;
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i += 1) {
      await expect(verifyOtp(handle.db, { phone: p, code: wrong, purpose: "login", ip: "203.0.113.9" })).rejects.toMatchObject({ code: "OTP_INVALID" });
    }
    await expect(verifyOtp(handle.db, { phone: p, code: wrong, purpose: "login", ip: "203.0.113.9" })).rejects.toMatchObject({ code: "OTP_LOCKED" });
    // the real code is burned with it
    await expect(verifyOtp(handle.db, { phone: p, code: right, purpose: "login", ip: "203.0.113.9" })).rejects.toThrow();
    expect(JSON.stringify(await handle.db.select().from(securityEvents))).toContain("otp.locked");
  });

  it("global breaker pauses sends and raises a security event", async () => {
    // global10m 8 × pauseMultiplier 2 = 16: beyond that every send is refused with RATE_LIMITED
    let paused = false;
    for (let i = 0; i < 40 && !paused; i += 1) {
      try {
        // a solved PoW keeps the sends flowing through the breaker's "captcha" band (> global10m) up to the pause line
        await requestOtp(handle.db, { phone: phone(), purpose: "login", ip: `198.51.${String(i % 200)}.7`, uaHash: `ua-${String(i)}`, powToken: "solved" });
      } catch (err: unknown) {
        const e = err as { code?: string; httpStatus?: number };
        expect(e.code).toBe("RATE_LIMITED");
        paused = true;
      }
    }
    expect(paused).toBe(true);
    const events = JSON.stringify(await handle.db.select().from(securityEvents));
    expect(events).toContain("otp.breaker");
    const alerts = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "telegram.notify" && j.payloadJson["kind"] === "otp.breaker");
    expect(alerts.length).toBeGreaterThan(0);
  });
});
