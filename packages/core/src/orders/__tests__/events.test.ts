import { describe, expect, it } from "vitest";
import { orderEvents } from "../events";
import type { OrderEvent } from "../../types";

const ev = (type: OrderEvent["type"], createdAt: string, payload: Record<string, unknown> | null = null): OrderEvent => ({
  id: Math.floor(Date.parse(createdAt) / 1000),
  type,
  payload,
  actor: { type: "system", id: null },
  createdAt,
});

describe("order events - customerTimeline", () => {
  it("hides admin notes and internal events; marks reached steps done", () => {
    const steps = orderEvents.customerTimeline([
      ev("placed", "2026-08-27T10:00:00.000Z"),
      ev("note", "2026-08-27T10:01:00.000Z"), // internal - not a step
      ev("payment.initiated", "2026-08-27T10:02:00.000Z"), // internal
      ev("status.paid", "2026-08-27T10:05:00.000Z"),
      ev("status.processing", "2026-08-27T11:00:00.000Z"),
    ]);
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey["placed"]!.done).toBe(true);
    expect(byKey["paid"]!.done).toBe(true);
    expect(byKey["processing"]!.done).toBe(true);
    expect(byKey["shipped"]!.done).toBe(false);
    expect(byKey["delivered"]!.done).toBe(false);
    expect(steps.some((s) => s.key === ("note" as never))).toBe(false);
  });

  it("the shipped step carries the tracking payload", () => {
    const steps = orderEvents.customerTimeline([
      ev("placed", "2026-08-27T10:00:00.000Z"),
      ev("status.shipped", "2026-08-28T10:00:00.000Z", { carrier: "post", trackingCode: "TP123", trackingUrl: "https://x" }),
    ]);
    const shipped = steps.find((s) => s.key === "shipped");
    expect(shipped?.done).toBe(true);
    expect(shipped?.tracking).toEqual({ carrier: "post", code: "TP123", url: "https://x" });
  });

  it("labels are Persian", () => {
    const steps = orderEvents.customerTimeline([ev("placed", "2026-08-27T10:00:00.000Z")]);
    expect(steps.find((s) => s.key === "placed")?.label).toBe("ثبت سفارش");
  });
});
