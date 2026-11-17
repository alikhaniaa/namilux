import type { Db } from "@namilux/db";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { LIMIT_ZERO_WARNING, STAGE_ORDER, createContext, stageEnabled, type SeedContext, type SeedStage } from "../context.js";

const DB = {} as unknown as Db;
const LOG = {} as unknown as Logger;
const AT = new Date("2026-08-25T10:00:00.000Z");

function ctx(over: Partial<Parameters<typeof createContext>[0]> = {}): SeedContext {
  return createContext({
    db: DB,
    extractDir: "/repo/data/extract",
    mediaDir: "/repo/.media",
    siteOrigin: "https://namilux.ir",
    dry: false,
    limit: null,
    force: false,
    only: null,
    log: LOG,
    now: () => AT,
    ...over,
  });
}

describe("createContext", () => {
  it("normalises stage order", () => {
    const c = ctx({ only: ["media", "fixtures"] });
    expect([...c.stages]).toEqual(["fixtures", "media"]);
    expect(c.report.stages).toEqual(["fixtures", "media"]);
  });

  it("dedupes repeated stages", () => {
    const c = ctx({ only: ["catalog", "catalog", "seo", "catalog"] });
    expect([...c.stages]).toEqual(["catalog", "seo"]);
  });

  it("only=null enables every stage in STAGE_ORDER", () => {
    const c = ctx();
    expect([...c.stages]).toEqual([...STAGE_ORDER]);
    expect(c.report.stages).toEqual([...STAGE_ORDER]);
  });

  it("only=[] enables nothing (an explicit empty selection is not 'everything')", () => {
    const c = ctx({ only: [] });
    expect([...c.stages]).toEqual([]);
    expect(STAGE_ORDER.some((s) => stageEnabled(c, s))).toBe(false);
  });

  it("catalog does not imply media", () => {
    const c = ctx({ only: ["catalog"] });
    expect(stageEnabled(c, "catalog")).toBe(true);
    expect(stageEnabled(c, "media")).toBe(false);
  });

  it("limit 0 means no limit", () => {
    const c = ctx({ limit: 0 });
    expect(c.limit).toBeNull();
    expect(c.report.limit).toBeNull();
    expect(c.report.warnings).toContain(LIMIT_ZERO_WARNING);
  });

  it("keeps a positive limit and warns about nothing", () => {
    const c = ctx({ limit: 20 });
    expect(c.limit).toBe(20);
    expect(c.report.limit).toBe(20);
    expect(c.report.warnings).toEqual([]);
  });

  it("rejects unknown stage", () => {
    expect(() => ctx({ only: ["nope" as SeedStage] })).toThrow("unknown stage: nope");
    expect(() => ctx({ only: ["catalog", "Media" as SeedStage] })).toThrow("unknown stage: Media");
  });

  it("carries the flags and dirs through to the context and the report", () => {
    const c = ctx({ dry: true, force: true, only: ["content"] });
    expect(c.dry).toBe(true);
    expect(c.force).toBe(true);
    expect(c.extractDir).toBe("/repo/data/extract");
    expect(c.mediaDir).toBe("/repo/.media");
    expect(c.siteOrigin).toBe("https://namilux.ir");
    expect(c.report.dryRun).toBe(true);
    expect(c.report.extractDir).toBe("/repo/data/extract");
    expect(c.report.mediaDir).toBe("/repo/.media");
    expect(c.report.gate).toBeNull();
  });

  it("uses the injected clock for the report start and exposes it as ctx.now", () => {
    const c = ctx();
    expect(c.report.startedAt).toBe("2026-08-25T10:00:00.000Z");
    expect(c.now()).toBe(AT);
  });

  it("defaults now() to the wall clock", () => {
    const before = Date.now();
    const c = createContext({
      db: DB,
      extractDir: "/e",
      mediaDir: "/m",
      siteOrigin: "https://namilux.ir",
      dry: false,
      limit: null,
      force: false,
      only: null,
      log: LOG,
    });
    expect(c.now().getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("stageEnabled", () => {
  it("answers per stage", () => {
    const c = ctx({ only: ["fixtures", "media"] });
    expect(stageEnabled(c, "fixtures")).toBe(true);
    expect(stageEnabled(c, "media")).toBe(true);
    expect(stageEnabled(c, "seo")).toBe(false);
  });
});
