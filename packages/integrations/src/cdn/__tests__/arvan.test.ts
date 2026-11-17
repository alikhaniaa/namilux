import { afterEach, describe, expect, it, vi } from "vitest";
import { arvanCdn } from "../arvan";

const DOMAIN = "namilux.ir";
const url = (n: number): string => `https://${DOMAIN}/product/p${n}/`;

describe("arvan cdn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("batches purge URLs in groups of 100", async () => {
    const batches: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse((init?.body as string)) as { purge_urls?: string[] };
      batches.push(body.purge_urls?.length ?? 0);
      return new Response("{}", { status: 200 });
    });
    const cdn = arvanCdn({ apiKey: "K", domain: DOMAIN });
    const urls = Array.from({ length: 250 }, (_, i) => url(i));
    const res = await cdn.purgeUrls(urls);
    expect(res.ok).toBe(true);
    expect(res.purged).toBe(250);
    expect(batches).toEqual([100, 100, 50]);
  });

  it("drops foreign-origin URLs", async () => {
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse((init?.body as string)) as { purge_urls?: string[] };
      sent.push(...(body.purge_urls ?? []));
      return new Response("{}", { status: 200 });
    });
    const cdn = arvanCdn({ apiKey: "K", domain: DOMAIN });
    const res = await cdn.purgeUrls([url(1), "https://evil.example/x/", "not-a-url"]);
    expect(sent).toEqual([url(1)]);
    expect(res.purged).toBe(1);
    expect(res.error).toContain("dropped");
  });

  it("retries once on 429 then succeeds", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? new Response("rate", { status: 429 }) : new Response("{}", { status: 200 });
    });
    const cdn = arvanCdn({ apiKey: "K", domain: DOMAIN });
    const res = await cdn.purgeUrls([url(1)]);
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("sends purge-all", async () => {
    let body: { purge?: string } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      body = JSON.parse((init?.body as string)) as { purge?: string };
      return new Response("{}", { status: 200 });
    });
    const cdn = arvanCdn({ apiKey: "K", domain: DOMAIN });
    expect((await cdn.purgeAll()).ok).toBe(true);
    expect(body!.purge).toBe("all");
  });
});
