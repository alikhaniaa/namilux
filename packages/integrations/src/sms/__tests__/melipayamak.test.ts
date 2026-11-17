import { afterEach, describe, expect, it, vi } from "vitest";
import { melipayamakDriver } from "../melipayamak";

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

describe("melipayamak", () => {
  it("pattern endpoint for otp", async () => {
    stubFetch(200, { Value: "123456789", RetStatus: 1, StrRetStatus: "Ok" });
    const d = melipayamakDriver({ username: "user1", password: "pass1", from: "5000", otpBodyId: 77 });
    const r = await d.send("09121234567", "111222", { otp: true });
    expect(r).toMatchObject({ ok: true, providerRef: "123456789" });
    expect(calls[0]?.url).toBe("https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber");
    const body = JSON.parse(calls[0]?.init?.body as string) as { bodyId: number; text: string; to: string };
    expect(body).toMatchObject({ bodyId: 77, text: "111222", to: "09121234567" });
  });

  it("plain send without a body id", async () => {
    stubFetch(200, { Value: "5", RetStatus: 1 });
    const d = melipayamakDriver({ username: "user1", password: "pass1", from: "5000" });
    const r = await d.send("09121234567", "سلام", { otp: true });
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://rest.payamak-panel.com/api/SendSMS/SendSMS");
  });

  it("credentials never logged", async () => {
    stubFetch(400, { Value: "0", RetStatus: 2, StrRetStatus: "InvalidCredentials user1/pass1" });
    const d = melipayamakDriver({ username: "user1", password: "pass1", from: "5000" });
    const r = await d.send("09121234567", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toContain("pass1");
      expect(r.error).not.toContain("user1");
      expect(r.retryable).toBe(false);
    }
  });
});
