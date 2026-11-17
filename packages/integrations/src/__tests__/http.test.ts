import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, httpJson } from "../http";

describe("httpJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries a 503 up to `retries` then returns the last response", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return new Response("busy", { status: 503 });
    });
    const res = await httpJson("https://p.test/x", { method: "GET", retries: 2 });
    expect(calls).toBe(3); // initial + 2 retries
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });

  it("does not retry a 400", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return new Response("bad", { status: 400 });
    });
    const res = await httpJson("https://p.test/x", { method: "GET", retries: 2 });
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
  });

  it("parses JSON bodies and passes through non-JSON as raw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    const res = await httpJson<{ a: number }>("https://p.test/x", { method: "GET" });
    expect(res.data).toEqual({ a: 1 });
    expect(res.raw).toContain("\"a\"");
  });

  it("wraps a network error in a retryable ProviderError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await expect(httpJson("https://p.test/x", { method: "GET", retries: 0 })).rejects.toBeInstanceOf(ProviderError);
  });

  it("caps the response body at 1 MB", async () => {
    const huge = "x".repeat(2 * 1024 * 1024);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(huge, { status: 200 }));
    const res = await httpJson("https://p.test/x", { method: "GET" });
    expect(res.raw.length).toBeLessThanOrEqual(1_048_576);
  });
});
