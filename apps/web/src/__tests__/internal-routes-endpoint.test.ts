import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate on the route oracle's endpoint (`app/api/internal/routes/route.ts`).
 *
 * It is the one `/api/internal/*` route with no HMAC - it changes nothing and returns only public
 * URLs, and no secret may be baked into the bundle the proxy runs in - so the private-address check
 * IS its authentication, and nothing asserted it. Caddy answers 404 for `/api/internal/*` on all
 * four vhosts (infra/server/caddy/); this is the app-level belt behind that brace, and the only
 * layer a `pnpm dev` run or a misconfigured edge is left with.
 */
const clientIp = vi.fn((): string => "127.0.0.1");
const servesLivePath = vi.fn(async (): Promise<boolean> => false);
const resolveRedirect = vi.fn(async (): Promise<{ to: string; code: number } | null> => null);
const recordNotFound = vi.fn(async (): Promise<void> => undefined);
const getCollectionBySlug = vi.fn(async (): Promise<object | null> => null);
const loadLiveRoutes = vi.fn(async (): Promise<string[]> => ["/", "/shop/"]);

vi.mock("@/lib/http-handler", () => ({ clientIp: () => clientIp() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/loaders/routes", () => ({ loadLiveRoutes: () => loadLiveRoutes() }));
vi.mock("@namilux/core", () => ({
  servesLivePath: () => servesLivePath(),
  resolveRedirect: () => resolveRedirect(),
  recordNotFound: (_db: unknown, path: string, referrer?: string) => {
    seen.push([path, referrer]);
    return recordNotFound();
  },
  getCollectionBySlug: () => getCollectionBySlug(),
}));

const seen: [string, string | undefined][] = [];
const { GET } = await import("@/app/api/internal/routes/route");

const ask = (query = "", headers: Record<string, string> = {}): Promise<Response> =>
  GET(new Request(`http://127.0.0.1:3000/api/internal/routes/${query}`, { headers }));

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  clientIp.mockReturnValue("127.0.0.1");
  servesLivePath.mockResolvedValue(false);
  resolveRedirect.mockResolvedValue(null);
  getCollectionBySlug.mockResolvedValue(null);
  loadLiveRoutes.mockResolvedValue(["/", "/shop/"]);
});

describe("GET /api/internal/routes/ — the loopback gate", () => {
  it("answers a public address 404, with no body and no database read", async () => {
    for (const ip of ["203.0.113.7", "8.8.8.8", "2001:db8::1", "172.32.0.1", "9.9.9.9"]) {
      clientIp.mockReturnValue(ip);
      const res = await ask();
      expect(res.status, ip).toBe(404);
      expect(await res.text()).toBe("");
    }
    expect(loadLiveRoutes).not.toHaveBeenCalled();
    expect(servesLivePath).not.toHaveBeenCalled();
  });

  it("answers a public address 404 for the per-path question too", async () => {
    clientIp.mockReturnValue("203.0.113.7");
    expect((await ask("?path=%2Fshop%2F")).status).toBe(404);
    expect(recordNotFound).not.toHaveBeenCalled();
  });

  it("lets loopback and the private ranges through", async () => {
    // "" is what clientIp returns when TRUST_PROXY is off - a developer machine with no edge in
    // front of it. On the box TRUST_PROXY is 1 and Caddy OVERWRITES x-forwarded-for with the real
    // client (never appends), so this branch is not reachable from the internet.
    for (const ip of ["127.0.0.1", "::1", "10.1.2.3", "192.168.1.9", "172.16.0.4", "172.31.255.1", ""]) {
      clientIp.mockReturnValue(ip);
      const res = await ask();
      expect(res.status, ip).toBe(200);
      expect(await res.json()).toEqual({ live: ["/", "/shop/"] });
    }
  });

  it("never stores its answer - the row behind a path can become a redirect at any moment", async () => {
    expect((await ask()).headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/internal/routes/?path= - the definitive answer", () => {
  it("reads the cached list first and does not touch the database for a listed path", async () => {
    expect(await (await ask("?path=%2Fshop%2F")).json()).toEqual({ kind: "live" });
    expect(servesLivePath).not.toHaveBeenCalled();
  });

  it("asks the database for a path newer than the list", async () => {
    servesLivePath.mockResolvedValue(true);
    expect(await (await ask("?path=%2Fproduct%2Fbrand-new%2F")).json()).toEqual({ kind: "live" });
  });

  it("knows the one namespace servesLivePath does not - collections", async () => {
    getCollectionBySlug.mockResolvedValue({ id: 1 });
    expect(await (await ask("?path=%2Fcollection%2Fnowruz%2F")).json()).toEqual({ kind: "live" });
    // A bare base and a nested path are not collection slugs and must not be asked as one.
    getCollectionBySlug.mockClear();
    expect(await (await ask("?path=%2Fcollection%2F")).json()).toEqual({ kind: "missing" });
    expect(await (await ask("?path=%2Fcollection%2Fa%2Fb%2F")).json()).toEqual({ kind: "missing" });
    expect(getCollectionBySlug).not.toHaveBeenCalled();
  });

  it("answers a redirect row with its own target and code", async () => {
    resolveRedirect.mockResolvedValue({ to: "/shop/", code: 301 });
    expect(await (await ask("?path=%2Fbrand%2Fphilips%2F")).json()).toEqual({ kind: "redirect", to: "/shop/", code: 301 });
  });

  it("records the miss with the referrer the proxy forwarded, and never fails on it", async () => {
    recordNotFound.mockRejectedValueOnce(new Error("monitor down"));
    const res = await ask("?path=%2Fgone%2F", { "x-nl-referer": "https://www.google.com/" });
    expect(await res.json()).toEqual({ kind: "missing" });
    expect(seen).toEqual([["/gone/", "https://www.google.com/"]]);
  });

  it("refuses a malformed or oversized path before any query runs", async () => {
    for (const q of ["?path=", "?path=shop", `?path=%2F${"a".repeat(2100)}`]) {
      expect(await (await ask(q)).json(), q).toEqual({ kind: "missing" });
    }
    expect(servesLivePath).not.toHaveBeenCalled();
    expect(recordNotFound).not.toHaveBeenCalled();
  });
});
