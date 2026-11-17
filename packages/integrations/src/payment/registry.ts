import type { PaymentDriverKey } from "@namilux/core/constants";
import { mockDriver } from "./mock";
import { snapppayDriver } from "./snapppay";
import type { PaymentDriver } from "./types";
import { zarinpalDriver } from "./zarinpal";

/**
 * Every gateway key is `| undefined` on purpose: under `exactOptionalPropertyTypes` a parsed app env
 * carries `string | undefined` for an optional variable, and callers pass that whole object.
 */
export type PaymentEnv = {
  PAYMENT_DRIVER: "mock" | "zarinpal" | "snapppay";
  ZARINPAL_MERCHANT_ID?: string | undefined;
  ZARINPAL_SANDBOX?: boolean | undefined;
  ZARINPAL_ACCESS_TOKEN?: string | undefined;
  ZARINPAL_TERMINAL_ID?: string | undefined;
  SNAPPPAY_BASE_URL?: string | undefined;
  SNAPPPAY_CLIENT_ID?: string | undefined;
  SNAPPPAY_CLIENT_SECRET?: string | undefined;
  SNAPPPAY_USERNAME?: string | undefined;
  SNAPPPAY_PASSWORD?: string | undefined;
  SNAPPPAY_CATEGORY?: string | undefined;
  SITE_ORIGIN: string;
  APP_ENV: string;
};

export function paymentDrivers(env: PaymentEnv): {
  payment(key: PaymentDriverKey): PaymentDriver;
  defaultKey: PaymentDriverKey;
  configured(key: PaymentDriverKey): boolean;
} {
  // The mock gateway must never load in production.
  const mockAllowed = env.APP_ENV !== "prod";

  const zarinpal = (): PaymentDriver =>
    zarinpalDriver({
      merchantId: env.ZARINPAL_MERCHANT_ID ?? "",
      sandbox: env.ZARINPAL_SANDBOX ?? false,
      ...(env.ZARINPAL_ACCESS_TOKEN !== undefined ? { accessToken: env.ZARINPAL_ACCESS_TOKEN } : {}),
      ...(env.ZARINPAL_TERMINAL_ID !== undefined ? { terminalId: env.ZARINPAL_TERMINAL_ID } : {}),
    });

  // SnappPay has no usable default: every one of the five values is issued per merchant at
  // onboarding, so an unconfigured driver must refuse loudly rather than fail at the first call.
  const snapppayConfigured =
    env.SNAPPPAY_BASE_URL !== undefined &&
    env.SNAPPPAY_CLIENT_ID !== undefined &&
    env.SNAPPPAY_CLIENT_SECRET !== undefined &&
    env.SNAPPPAY_USERNAME !== undefined &&
    env.SNAPPPAY_PASSWORD !== undefined;

  const snapppay = (): PaymentDriver => {
    if (!snapppayConfigured) throw new Error("snapppay driver is not configured (SNAPPPAY_BASE_URL / CLIENT_ID / CLIENT_SECRET / USERNAME / PASSWORD)");
    return snapppayDriver({
      baseUrl: env.SNAPPPAY_BASE_URL ?? "",
      clientId: env.SNAPPPAY_CLIENT_ID ?? "",
      clientSecret: env.SNAPPPAY_CLIENT_SECRET ?? "",
      username: env.SNAPPPAY_USERNAME ?? "",
      password: env.SNAPPPAY_PASSWORD ?? "",
      ...(env.SNAPPPAY_CATEGORY !== undefined ? { category: env.SNAPPPAY_CATEGORY } : {}),
    });
  };

  const mock = (): PaymentDriver => {
    if (!mockAllowed) throw new Error("mock payment driver is not allowed in production");
    return mockDriver({ siteOrigin: env.SITE_ORIGIN });
  };

  if (env.PAYMENT_DRIVER === "mock" && !mockAllowed) {
    throw new Error("PAYMENT_DRIVER=mock is not allowed in production");
  }

  return {
    payment(key: PaymentDriverKey): PaymentDriver {
      if (key === "zarinpal") return zarinpal();
      if (key === "snapppay") return snapppay();
      if (key === "mock") return mock();
      throw new Error(`unknown payment driver: ${key}`);
    },
    /** Whether a driver can be built at all - checkout uses it to decide which methods to offer. */
    configured(key: PaymentDriverKey): boolean {
      if (key === "zarinpal") return env.ZARINPAL_MERCHANT_ID !== undefined;
      if (key === "snapppay") return snapppayConfigured;
      if (key === "mock") return mockAllowed;
      return false;
    },
    defaultKey: env.PAYMENT_DRIVER,
  };
}
