import { describe, expect, it } from "vitest";
import { issueChallenge, solveInBrowser, verifySolution } from "../pow";

const KEY = "0123456789abcdef";

describe("pow captcha", () => {
  it("solve + verify roundtrip at 12 bits", async () => {
    const challenge = issueChallenge({ key: KEY, bits: 12 }, "otp:09121230077");
    const solution = await solveInBrowser(challenge);
    expect(verifySolution({ key: KEY }, "otp:09121230077", solution)).toEqual({ ok: true });
  });

  it("wrong scope fails signature", async () => {
    const challenge = issueChallenge({ key: KEY, bits: 12 }, "otp:09121230077");
    const solution = await solveInBrowser(challenge);
    expect(verifySolution({ key: KEY }, "otp:09000000000", solution)).toEqual({ ok: false, reason: "sig" });
  });

  it("tampered bits fail signature (no difficulty downgrade)", async () => {
    const challenge = issueChallenge({ key: KEY, bits: 12 }, "s");
    const solution = await solveInBrowser(challenge);
    expect(verifySolution({ key: KEY }, "s", { ...solution, bits: 1 })).toEqual({ ok: false, reason: "sig" });
  });

  it("expired fails", async () => {
    const challenge = issueChallenge({ key: KEY, bits: 12, ttlSec: -1 }, "s");
    const solution = await solveInBrowser(challenge);
    expect(verifySolution({ key: KEY }, "s", solution)).toEqual({ ok: false, reason: "expired" });
  });

  it("insufficient work fails", async () => {
    const challenge = issueChallenge({ key: KEY, bits: 20 }, "s");
    // a nonce of 0 almost certainly does not meet 20 leading zero bits
    expect(verifySolution({ key: KEY }, "s", { ...challenge, nonce: 0 })).toEqual({ ok: false, reason: "work" });
  });
});
