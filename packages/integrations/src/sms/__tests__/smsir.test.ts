import { afterEach, describe, expect, it, vi } from "vitest";
import { smsirDriver } from "../smsir";

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

describe("smsir", () => {
  it("verify endpoint for otp", async () => {
    stubFetch(200, { status: 1, data: { messageId: 991 } });
    const d = smsirDriver({ apiKey: "SECRET-KEY", lineNumber: "3000", otpTemplateId: 12 });
    const r = await d.send("09121234567", "654321", { otp: true });
    expect(r).toMatchObject({ ok: true, providerRef: "991" });
    expect(calls[0]?.url).toBe("https://api.sms.ir/v1/send/verify");
    const body = JSON.parse(calls[0]?.init?.body as string) as { templateId: number; parameters: { name: string; value: string }[] };
    expect(body.templateId).toBe(12);
    expect(body.parameters[0]).toEqual({ name: "CODE", value: "654321" });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("SECRET-KEY");
    expect(calls[0]?.url).not.toContain("SECRET-KEY");
  });

  it("bulk endpoint otherwise", async () => {
    stubFetch(200, { status: 1, data: { messageIds: [5], cost: 1200 } });
    const d = smsirDriver({ apiKey: "k", lineNumber: "3000" });
    const r = await d.send("09121234567", "سلام", { otp: true });
    expect(r).toEqual({ ok: true, providerRef: "5", segments: 1, costToman: 120 });
    expect(calls[0]?.url).toBe("https://api.sms.ir/v1/send/bulk");
  });

  it("error mapping", async () => {
    stubFetch(400, { status: 0, message: "bad line SECRET-KEY" });
    const d = smsirDriver({ apiKey: "SECRET-KEY", lineNumber: "3000" });
    const r = await d.send("09121234567", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryable).toBe(false);
      expect(r.error).not.toContain("SECRET-KEY");
    }
    stubFetch(503, { status: 0, message: "down" });
    const r2 = await d.send("09121234567", "x");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.retryable).toBe(true);
  });
});
