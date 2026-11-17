import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GATE_EXPECTED,
  GATE_SKIPPED_LIMIT,
  createReport,
  evaluateGate,
  finishReport,
  formatSummary,
  warn,
  writeReport,
  type SeedReport,
} from "../report.js";

function fresh(over: Partial<Parameters<typeof createReport>[0]> = {}): SeedReport {
  return createReport({
    startedAt: new Date("2026-08-25T10:00:00.000Z"),
    dryRun: false,
    limit: null,
    stages: ["fixtures", "catalog"],
    extractDir: "/repo/data/extract",
    mediaDir: "/repo/.media",
    ...over,
  });
}

/** A report that satisfies every M0 gate expectation. */
function passing(): SeedReport {
  const r = fresh();
  r.products = GATE_EXPECTED.products;
  r.categories = GATE_EXPECTED.categories;
  r.brands = GATE_EXPECTED.brands;
  r.posts = GATE_EXPECTED.posts;
  r.pages = GATE_EXPECTED.pages;
  r.redirects = GATE_EXPECTED.redirectsMin;
  r.withImages = GATE_EXPECTED.withImages;
  r.media.normalized = GATE_EXPECTED.normalized.target;
  r.media.quarantined = GATE_EXPECTED.quarantined.target;
  return r;
}

describe("createReport", () => {
  it("starts every count at zero and carries the run flags", () => {
    const r = fresh({ dryRun: true, limit: 20 });
    expect(r.version).toBe(2);
    expect(r.startedAt).toBe("2026-08-25T10:00:00.000Z");
    expect(r.finishedAt).toBeNull();
    expect(r.durationMs).toBeNull();
    expect(r.dryRun).toBe(true);
    expect(r.limit).toBe(20);
    expect(r.stages).toEqual(["fixtures", "catalog"]);
    expect(r.products).toBe(0);
    expect(r.media.normalized).toBe(0);
    expect(r.media.failures).toEqual([]);
    expect(r.fixtures.ownerCreated).toBe(false);
    expect(r.legacyOrders).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.gate).toBeNull();
  });

  it("copies the stage list (later mutation of the argument does not leak in)", () => {
    const stages = ["fixtures"];
    const r = fresh({ stages });
    stages.push("media");
    expect(r.stages).toEqual(["fixtures"]);
  });
});

describe("evaluateGate", () => {
  it("gate passes on the documented counts", () => {
    const g = evaluateGate(passing());
    expect(g.ok).toBe(true);
    expect(g.checks).toHaveLength(11);
    expect(g.checks.every((c) => c.ok)).toBe(true);
    expect(g.checks.map((c) => c.name)).toContain("media.normalized");
  });

  it("gate fails outside ±5", () => {
    const r = passing();
    r.media.normalized = 263;
    const g = evaluateGate(r);
    expect(g.ok).toBe(false);
    const check = g.checks.find((c) => c.name === "media.normalized");
    expect(check).toBeDefined();
    expect(check?.ok).toBe(false);
    expect(check?.actual).toBe("263");
    expect(check?.expected).toBe("269 +/- 5");
    // the edge of the band still passes
    r.media.normalized = 264;
    expect(evaluateGate(r).ok).toBe(true);
    r.media.quarantined = 32;
    expect(evaluateGate(r).ok).toBe(false);
  });

  it("accepts redirects above the minimum but not below", () => {
    const r = passing();
    r.redirects = 40;
    expect(evaluateGate(r).ok).toBe(true);
    r.redirects = 19;
    const failed = evaluateGate(r).checks.find((c) => c.name === "redirects");
    expect(failed?.ok).toBe(false);
    expect(failed?.expected).toBe(">= 20");
  });

  it("fails when a contract path is unmatched or an image failed", () => {
    const r = passing();
    r.unmatchedContractPaths = ["/تست/"];
    expect(evaluateGate(r).checks.find((c) => c.name === "unmatchedContractPaths")?.ok).toBe(false);

    const r2 = passing();
    r2.media.failures = [{ productId: 63015, n: 1, file: "a.jpg", error: "unsupported" }];
    expect(evaluateGate(r2).checks.find((c) => c.name === "media.failures")?.ok).toBe(false);
  });

  it("gate skipped when limited", () => {
    const r = passing();
    r.limit = 20;
    r.products = 20;
    const g = evaluateGate(r);
    expect(g.ok).toBe(true);
    expect(g.checks).toEqual([]);
    expect(r.warnings).toContain(GATE_SKIPPED_LIMIT);
  });

  it("still evaluates the gate on a dry run", () => {
    const r = passing();
    r.dryRun = true;
    expect(evaluateGate(r).ok).toBe(true);
    r.products = 540;
    const g = evaluateGate(r);
    expect(g.ok).toBe(false);
    expect(g.checks.find((c) => c.name === "products")?.actual).toBe("540");
  });
});

describe("finishReport", () => {
  it("sets finishedAt, durationMs and the gate on the same object", () => {
    const r = passing();
    const out = finishReport(r, new Date("2026-08-25T10:00:47.100Z"));
    expect(out).toBe(r);
    expect(r.finishedAt).toBe("2026-08-25T10:00:47.100Z");
    expect(r.durationMs).toBe(47_100);
    expect(r.gate?.ok).toBe(true);
  });

  it("never reports a negative duration", () => {
    const r = passing();
    finishReport(r, new Date("2026-08-25T09:59:00.000Z"));
    expect(r.durationMs).toBe(0);
  });
});

describe("warn", () => {
  it("warn dedupes", () => {
    const r = fresh();
    warn(r, "media.csv parse failed");
    warn(r, "media.csv parse failed");
    warn(r, "another");
    expect(r.warnings).toEqual(["media.csv parse failed", "another"]);
  });
});

describe("formatSummary", () => {
  it("summary lists every failed check", () => {
    const r = passing();
    r.products = 500;
    r.media.normalized = 200;
    r.redirects = 3;
    finishReport(r, new Date("2026-08-25T10:01:00.000Z"));
    const s = formatSummary(r);
    expect(s).toContain("gate: FAIL");
    expect(s).toContain("[x] products: expected 541, actual 500");
    expect(s).toContain("[x] media.normalized: expected 269 +/- 5, actual 200");
    expect(s).toContain("[x] redirects: expected >= 20, actual 3");
    // passing checks are not listed
    expect(s).not.toContain("[x] brands");
    expect(s.split("\n").filter((l) => l.includes("[x]"))).toHaveLength(3);
  });

  it("prints the mode, the warnings and a passing gate", () => {
    const r = passing();
    r.dryRun = true;
    warn(r, "media dir missing");
    finishReport(r, new Date("2026-08-25T10:00:10.000Z"));
    const s = formatSummary(r);
    expect(s).toContain("namilux seed report v2");
    expect(s).toContain("dry-run");
    expect(s).toContain("! media dir missing");
    expect(s).toContain("gate: PASS (11/11)");
    expect(s).toContain("10.0s");
  });

  it("says so when the gate was never evaluated or was skipped", () => {
    expect(formatSummary(fresh())).toContain("gate: not evaluated");
    const limited = fresh({ limit: 5 });
    finishReport(limited, new Date("2026-08-25T10:00:01.000Z"));
    const s = formatSummary(limited);
    expect(s).toContain("gate: SKIPPED");
    expect(s).toContain(`! ${GATE_SKIPPED_LIMIT}`);
  });
});

describe("writeReport", () => {
  it("creates missing directories and writes 2-space JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "namilux-seed-report-"));
    const file = join(dir, "nested", "seed-report.json");
    try {
      const r = passing();
      finishReport(r, new Date("2026-08-25T10:00:05.000Z"));
      await writeReport(r, file);
      const raw = await readFile(file, "utf8");
      expect(raw).toContain('\n  "version": 2,');
      expect(JSON.parse(raw)).toEqual(r);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
