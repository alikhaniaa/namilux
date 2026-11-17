import { describe, expect, it } from "vitest";
import { describeForGateway, maskPan, paymentLinkFor } from "../payments";
import type { Order } from "../../types";

const order = { code: "NL-7Q2F4" } as Order;

describe("payments - pure helpers", () => {
  it("maskPan keeps the first 6 and last 4 digits", () => {
    expect(maskPan("6037991122334455")).toBe("6037-99**-****-4455");
    expect(maskPan(undefined)).toBeNull();
    expect(maskPan("123")).toBeNull(); // not a 16-digit PAN
    expect(maskPan("۶۰۳۷۹۹۱۱۲۲۳۳۴۴۵۵")).toBe("6037-99**-****-4455"); // folds Persian digits
  });

  it("describeForGateway carries the order code and no PII, ≤ 100 chars", () => {
    const d = describeForGateway(order);
    expect(d).toContain("NL-7Q2F4");
    expect(d.length).toBeLessThanOrEqual(100);
  });

  it("paymentLinkFor builds the /pay/<code>/ url", () => {
    expect(paymentLinkFor(order, { SITE_ORIGIN: "https://namilux.ir" })).toBe("https://namilux.ir/pay/NL-7Q2F4/");
  });
});
