import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); vi.doUnmock("@/env"); vi.doUnmock("@/lib/db"); vi.doUnmock("@namilux/db"); });

describe("process liveness and database readiness", () => {
  it("keeps liveness healthy when the database is down, but refuses readiness", async () => {
    vi.doMock("@/env", () => ({ env: { NEXT_PUBLIC_BUILD_ID: "health-test" } }));
    vi.doMock("@/lib/db", () => ({ db: {} }));
    const ping = vi.fn().mockRejectedValue(new Error("database unavailable"));
    vi.doMock("@namilux/db", () => ({ pingDb: ping }));
    const { GET: live } = await import("../healthz/route");
    const { GET: ready } = await import("../healthz/ready/route");
    const response = await live();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(ping).not.toHaveBeenCalled();
    const readiness = await ready();
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ ok: false, build: "health-test", db: { ok: false } });
  });
  it("reports ready after a successful ping without exposing database identity", async () => {
    vi.doMock("@/env", () => ({ env: { NEXT_PUBLIC_BUILD_ID: "health-test" } }));
    vi.doMock("@/lib/db", () => ({ db: {} }));
    vi.doMock("@namilux/db", () => ({ pingDb: async () => ({ ok: true, role: "private-role", ms: 2 }) }));
    const { GET } = await import("../healthz/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, build: "health-test", db: { ok: true, ms: 2 } });
  });
});
