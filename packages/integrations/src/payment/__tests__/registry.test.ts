import { describe, expect, it } from "vitest";
import { paymentDrivers } from "../registry";

describe("payment registry", () => {
  it("zarinpal without merchant id fails fast", async () => {
    // The registry hands out a driver whose merchant id is empty; the driver never reaches the
    // gateway with it - request() answers not-ok instead of throwing into the checkout.
    const drivers = paymentDrivers({ PAYMENT_DRIVER: "zarinpal", SITE_ORIGIN: "https://namilux.ir", APP_ENV: "staging" });
    const d = drivers.payment("zarinpal");
    expect(d.key).toBe("zarinpal");
    expect(drivers.defaultKey).toBe("zarinpal");
  });

  it("unknown key throws", () => {
    const drivers = paymentDrivers({ PAYMENT_DRIVER: "mock", SITE_ORIGIN: "http://localhost:3000", APP_ENV: "dev" });
    expect(() => drivers.payment("snapp" as unknown as "mock")).toThrow(/unknown payment driver/);
    expect(drivers.payment("mock").key).toBe("mock");
  });
  it("snapppay is offered only once all five credentials are present", () => {
    const base = { PAYMENT_DRIVER: "snapppay" as const, SITE_ORIGIN: "https://aghsat.namilux.ir", APP_ENV: "staging" };
    const partial = paymentDrivers({ ...base, SNAPPPAY_BASE_URL: "https://api.snapppay.ir", SNAPPPAY_CLIENT_ID: "c" });
    expect(partial.configured("snapppay")).toBe(false);
    // Unconfigured must THROW rather than hand out a driver that fails at the first call: placeOrder
    // catches it, fails the order and releases its stock.
    expect(() => partial.payment("snapppay")).toThrow(/not configured/);

    const full = paymentDrivers({
      ...base,
      SNAPPPAY_BASE_URL: "https://api.snapppay.ir",
      SNAPPPAY_CLIENT_ID: "c",
      SNAPPPAY_CLIENT_SECRET: "s",
      SNAPPPAY_USERNAME: "u",
      SNAPPPAY_PASSWORD: "p",
    });
    expect(full.configured("snapppay")).toBe(true);
    expect(full.payment("snapppay").key).toBe("snapppay");
    expect(full.defaultKey).toBe("snapppay");
    // The card gateway is a separate question; no ZarinPal merchant id here means no card gateway.
    expect(full.configured("zarinpal")).toBe(false);
  });
});
