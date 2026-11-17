import { afterEach, describe, expect, it, vi } from "vitest";
import { kavenegarDriver } from "../kavenegar";

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("kavenegar", () => {
  it("uses lookup for otp when template set", async () => {
    stubFetch(200, { return: { status: 200 }, entries: [{ messageid: 42, cost: 1200, parts: 1 }] });
    const d = kavenegarDriver({ apiKey: "KEY123", sender: "10004", otpTemplate: "namilux-otp" });
    const r = await d.send("09121234567", "123456", { otp: true });
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toContain("/verify/lookup.json");
    expect(calls[0]?.url).toContain("template=namilux-otp");
    expect(calls[0]?.url).toContain("token=123456");
  });

  it("maps 200 → ok", async () => {
    stubFetch(200, { return: { status: 200 }, entries: [{ messageid: 7, cost: 1500, parts: 2 }] });
    const d = kavenegarDriver({ apiKey: "KEY123", sender: "10004" });
    const r = await d.send("09121234567", "سلام");
    expect(r).toEqual({ ok: true, providerRef: "7", segments: 2, costToman: 150 });
    expect(calls[0]?.url).toContain("/sms/send.json");
  });

  it("strips api key from errors", async () => {
    stubFetch(401, { return: { status: 401, message: "invalid key KEY123 given" } });
    const d = kavenegarDriver({ apiKey: "KEY123", sender: "10004" });
    const r = await d.send("09121234567", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toContain("KEY123");
      expect(r.error).toContain("***");
      expect(r.retryable).toBe(false);
    }
  });

  it("cost Rial→Toman", async () => {
    stubFetch(200, { entries: { remaincredit: 250_000 } });
    const d = kavenegarDriver({ apiKey: "KEY123", sender: "10004" });
    expect(await d.balance?.()).toBe(25_000);
  });
});
