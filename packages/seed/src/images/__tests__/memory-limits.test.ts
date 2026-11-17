import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertDecodeBudget, fitOutside, SHARP_CACHE, SHARP_CONCURRENCY, configureSharpLimits } from "../limits";
import { emitRenditions } from "../renditions";
import type { ObjectStore } from "../manifest";

describe("image memory bounds", () => {
  it("rejects an oversized decoded buffer before allocation", () => {
    expect(() => assertDecodeBudget(10000, 10000, 3, "test")).toThrow("over the");
    expect(() => assertDecodeBudget(1600, 2000, 4, "test")).not.toThrow();
  });
  it("shrinks large photos without upscaling small sources", () => {
    expect(fitOutside(8000, 6000, 2400)).toEqual({ width: 3200, height: 2400 });
    expect(fitOutside(800, 600, 2400)).toEqual({ width: 800, height: 600 });
    configureSharpLimits();
    expect(sharp.concurrency()).toBe(SHARP_CONCURRENCY);
    expect(sharp.cache().memory.max).toBe(SHARP_CACHE.memory);
  });
  it("stops before image decode when its job was aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("test cancellation"));
    await expect(emitRenditions(Buffer.from("not even an image"), "product", "test", {} as ObjectStore,
      { signal: controller.signal })).rejects.toThrow("test cancellation");
  });
});
