import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const BASE = (process.env["E2E_BASE_URL"] ?? "").replace(/\/$/, "");
const KEY = process.env["INTERNAL_SIGNING_KEY"] ?? "";
const BODY = JSON.stringify({ tags: ["home"] });

function signed(ts: number, body: string, key = KEY): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-nl-ts": String(ts),
    "x-nl-sig": createHmac("sha256", key).update(`${String(ts)}.${body}`).digest("hex"),
  };
}

describe.skipIf(BASE === "")("internal routes", () => {
  it("unsigned request rejected", async () => {
    const res = await fetch(`${BASE}/api/internal/revalidate/`, { method: "POST", headers: { "content-type": "application/json" }, body: BODY });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    // a wrong key is as good as no signature
    const wrong = await fetch(`${BASE}/api/internal/revalidate/`, { method: "POST", headers: signed(Date.now(), BODY, "not-the-key"), body: BODY });
    expect(wrong.status).toBe(401);
  });

  it.skipIf(KEY === "")("stale timestamp rejected", async () => {
    const stale = await fetch(`${BASE}/api/internal/revalidate/`, { method: "POST", headers: signed(Date.now() - 10 * 60_000, BODY), body: BODY });
    expect(stale.status).toBe(401);
    const future = await fetch(`${BASE}/api/internal/revalidate/`, { method: "POST", headers: signed(Date.now() + 10 * 60_000, BODY), body: BODY });
    expect(future.status).toBe(401);
    // the timestamp is inside the signed string: a fresh signature over a tampered body fails too
    const tampered = await fetch(`${BASE}/api/internal/revalidate/`, { method: "POST", headers: signed(Date.now(), BODY), body: JSON.stringify({ tags: ["all"] }) });
    expect(tampered.status).toBe(401);
    const fresh = await fetch(`${BASE}/api/internal/revalidate/`, { method: "POST", headers: signed(Date.now(), BODY), body: BODY });
    expect(fresh.status).toBe(200);
  });

  it.skip("public edge cannot reach /api/internal (Caddy 404)", () => {
    // the spec: the Caddy front answers 404 for /api/internal/* from anything but the worker's loopback;
    // that layer does not exist in a local `pnpm dev` run - verified on the deployed edge (the spec checklist).
  });
});
