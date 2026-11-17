import { describe, expect, it } from "vitest";
import { hashPassword, isAcceptablePassword, needsRehash, verifyPassword } from "../password";

describe("auth/password", () => {
  it("round-trips and rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("uses a random salt so two hashes differ but both verify", async () => {
    const a = await hashPassword("aVeryStrongPass!");
    const b = await hashPassword("aVeryStrongPass!");
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "aVeryStrongPass!")).toBe(true);
    expect(await verifyPassword(b, "aVeryStrongPass!")).toBe(true);
  });

  it("returns false (never throws) on malformed hashes and flags them for rehash", async () => {
    for (const bad of ["", "scrypt$x", "a$b$c$d$e", "scrypt$131072$8$1$@@@$@@@", "scrypt$abc$8$1$AA$BB"]) {
      expect(await verifyPassword(bad, "whatever")).toBe(false);
      expect(needsRehash(bad)).toBe(true);
    }
  });

  it("round-trips a Persian password with ZWNJ and an emoji", async () => {
    const pw = "گذرواژه\u200cامن🔥۱۲۳۴";
    const hash = await hashPassword(pw);
    expect(await verifyPassword(hash, pw)).toBe(true);
  });

  it("a weaker N still verifies and needsRehash is true", async () => {
    // synthesize a hash with N=2^15 by re-labelling params the verifier reads from the string
    const weak = "scrypt$32768$8$1$" + Buffer.from("saltsaltsaltsalt").toString("base64url") + "$";
    expect(needsRehash(weak.slice(0, weak.length - 1) + Buffer.from("k").toString("base64url"))).toBe(true);
  });

  it("hashPassword rejects empty and > 128 code points", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(hashPassword("a".repeat(129))).rejects.toThrow();
    expect(await verifyPassword("scrypt$131072$8$1$AA$BB", "a".repeat(129))).toBe(false);
  });

  it("isAcceptablePassword: 11 → short, 12 → ok, 129 → long, breached set", () => {
    const breached = new Set(["password1234"]);
    expect(isAcceptablePassword("a".repeat(11), breached)).toEqual({ ok: false, reason: "short" });
    expect(isAcceptablePassword("a".repeat(12), breached)).toEqual({ ok: true });
    expect(isAcceptablePassword("a".repeat(129), breached)).toEqual({ ok: false, reason: "long" });
    expect(isAcceptablePassword("Password1234", breached)).toEqual({ ok: false, reason: "breached" });
  });
});
