import { describe, expect, it } from "vitest";
import { isGsm7, segmentsFor } from "../segments";

describe("sms/segments", () => {
  it("70 Persian chars = 1 segment, 71 = 2", () => {
    expect(segmentsFor("ا".repeat(70))).toBe(1);
    expect(segmentsFor("ا".repeat(71))).toBe(2);
  });
  it("emoji counts as 2 code units", () => {
    expect(segmentsFor("🔥".repeat(35))).toBe(1);
    expect(segmentsFor("🔥".repeat(36))).toBe(2);
  });
  it("gsm7 detection", () => {
    expect(isGsm7("Hello 123")).toBe(true);
    expect(isGsm7("سلام")).toBe(false);
    expect(segmentsFor("A".repeat(160))).toBe(1);
    expect(segmentsFor("A".repeat(161))).toBe(2);
  });
});
