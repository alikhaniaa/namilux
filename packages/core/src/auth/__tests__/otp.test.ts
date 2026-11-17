import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { configureOtp, generateOtpCode, hashOtp, requestOtp, verifyOtp } from "../index";
import { breaker } from "../breaker";
import { eq, otpCodes, sql } from "@namilux/db";

describe("auth/otp - pure", () => {
  it("generateOtpCode returns 6 Latin digits with leading zeros preserved", () => {
    for (let i = 0; i < 200; i += 1) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
  it("hashOtp is sha256(code + pepper) hex and differs per pepper", () => {
    const h = hashOtp("123456", "p");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp("123456", "p")).toBe(h);
    expect(hashOtp("123456", "q")).not.toBe(h);
  });
  it("throws INTERNAL when adapters are not configured", async () => {
    await expect(
      requestOtp({} as never, { phone: "09121230077", purpose: "login", ip: "1.2.3.4", uaHash: "x" }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe.skipIf(!hasTestDb())("auth/otp — request + verify against Postgres", () => {
  let handle: TestDb;
  let lastCode = "";

  beforeAll(async () => {
    process.env.OTP_PEPPER = process.env.OTP_PEPPER ?? "a".repeat(64);
    handle = await createTestDb();
    configureOtp({
      send: async ({ code }) => {
        lastCode = code;
        return { ok: true, providerRef: "test" };
      },
      verifyPow: async () => true,
    });
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(() => {
    breaker.resetForTests();
    lastCode = "";
  });

  it("happy path: request sends once (resendAfterSec 60), verify returns a customerId (isNew true then false)", async () => {
    await withTestTx(handle.db, async (tx) => {
      const r = await requestOtp(tx, { phone: "09121230077", purpose: "login", ip: "9.9.9.1", uaHash: "ua" });
      expect(r.resendAfterSec).toBe(60);
      expect(lastCode).toMatch(/^\d{6}$/);
      const v = await verifyOtp(tx, { phone: "09121230077", code: lastCode, purpose: "login", ip: "9.9.9.1" });
      expect(v.customerId).toHaveLength(26);
      expect(v.isNew).toBe(true);

      // a second login of the same phone is not "new"
      await requestOtp(tx, { phone: "09121230077", purpose: "login", ip: "9.9.9.2", uaHash: "ua" });
      const v2 = await verifyOtp(tx, { phone: "09121230077", code: lastCode, purpose: "login", ip: "9.9.9.2" });
      expect(v2.isNew).toBe(false);
    });
  });

  it("rejects a landline number with VALIDATION", async () => {
    await withTestTx(handle.db, async (tx) => {
      await expect(
        requestOtp(tx, { phone: "0211234567", purpose: "login", ip: "9.9.9.3", uaHash: "ua" }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  it("reports the same three-minute expiry during the resend cooldown and accepts a code after one minute", async () => {
    await withTestTx(handle.db, async (tx) => {
      const phone = "09121230079";
      const input = { phone, purpose: "login" as const, ip: "9.9.9.7", uaHash: "ua" };
      const issued = await requestOtp(tx, input);
      const originalCode = lastCode;
      const [row] = await tx.select().from(otpCodes).where(eq(otpCodes.phone, phone));
      expect(row).toBeDefined();
      if (row === undefined || issued.expiresAt === null) throw new Error("OTP was not issued");
      expect(new Date(issued.expiresAt).getTime() - row.createdAt.getTime()).toBe(180_000);
      const repeated = await requestOtp(tx, input);
      expect(repeated.expiresAt).toBe(issued.expiresAt);
      expect(lastCode).toBe(originalCode);
      // Simulate 90 seconds elapsed, without waiting or changing the machine's clock.
      await tx.update(otpCodes).set({ createdAt: sql`now() - interval '90 seconds'`, expiresAt: sql`now() + interval '90 seconds'` }).where(eq(otpCodes.phone, phone));
      await expect(verifyOtp(tx, { phone, code: originalCode, purpose: "login", ip: input.ip })).resolves.toHaveProperty("customerId");
    });
  });

  it("rejects the code when the three-minute expiry has passed", async () => {
    await withTestTx(handle.db, async (tx) => {
      const phone = "09121230080";
      await requestOtp(tx, { phone, purpose: "login", ip: "9.9.9.8", uaHash: "ua" });
      await tx.update(otpCodes).set({ createdAt: sql`now() - interval '181 seconds'`, expiresAt: sql`now() - interval '1 second'` }).where(eq(otpCodes.phone, phone));
      await expect(verifyOtp(tx, { phone, code: lastCode, purpose: "login", ip: "9.9.9.8" })).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    });
  });

  it("five wrong codes lock the code (OTP_LOCKED); a wrong code before that is OTP_INVALID", async () => {
    await withTestTx(handle.db, async (tx) => {
      await requestOtp(tx, { phone: "09121230088", purpose: "login", ip: "9.9.9.4", uaHash: "ua" });
      const wrong = lastCode === "000000" ? "111111" : "000000";
      for (let i = 0; i < 4; i += 1) {
        await expect(
          verifyOtp(tx, { phone: "09121230088", code: wrong, purpose: "login", ip: "9.9.9.4" }),
        ).rejects.toMatchObject({ code: "OTP_INVALID" });
      }
      await expect(
        verifyOtp(tx, { phone: "09121230088", code: wrong, purpose: "login", ip: "9.9.9.4" }),
      ).rejects.toMatchObject({ code: "OTP_LOCKED" });
    });
  });
});
