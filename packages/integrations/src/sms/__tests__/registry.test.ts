import { afterEach, describe, expect, it, vi } from "vitest";
import { smsDriver } from "../registry";

const base = { MEDIA_DIR: "/tmp/media", APP_ENV: "dev" } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sms registry", () => {
  it("fails fast without keys", () => {
    expect(() => smsDriver({ ...base, SMS_DRIVER: "kavenegar" })).toThrow(/SMS_API_KEY/);
    expect(() => smsDriver({ ...base, SMS_DRIVER: "kavenegar", SMS_API_KEY: "k" })).toThrow(/SMS_SENDER/);
    expect(() => smsDriver({ ...base, SMS_DRIVER: "smsir", SMS_API_KEY: "k" })).toThrow(/SMS_SENDER/);
    expect(() => smsDriver({ ...base, SMS_DRIVER: "melipayamak", SMS_SENDER: "s" })).toThrow(/SMS_USERNAME/);
    expect(smsDriver({ ...base, SMS_DRIVER: "kavenegar", SMS_API_KEY: "k", SMS_SENDER: "10004" }).key).toBe("kavenegar");
    expect(smsDriver({ ...base, SMS_DRIVER: "smsir", SMS_API_KEY: "k", SMS_SENDER: "3000" }).key).toBe("smsir");
    expect(smsDriver({ ...base, SMS_DRIVER: "melipayamak", SMS_USERNAME: "u", SMS_PASSWORD: "p", SMS_SENDER: "5000" }).key).toBe("melipayamak");
  });

  it("mock refused in prod", () => {
    expect(() => smsDriver({ ...base, SMS_DRIVER: "mock", APP_ENV: "prod" })).toThrow(/production/);
    expect(smsDriver({ ...base, SMS_DRIVER: "mock" }).key).toBe("mock");
  });

  it("SMS_PATTERNS reaches the driver - without it every send is free text", async () => {
    // The bug this guards: apps/web and apps/worker each built the driver without SMS_PATTERNS, so
    // the map on the box was never read and every message - login codes included - took the
    // moderated free-text route while the API still answered `success`.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ status: "success", data: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const env = { ...base, SMS_DRIVER: "farazsms", SMS_API_KEY: "k", SMS_SENDER: "3000505" } as const;

    const wired = smsDriver({ ...env, SMS_PATTERNS: '{"otp":"6dd60ORlkc"}' });
    await wired.send("09121234567", "کد ورود", { otp: true, template: "otp", vars: { code: "123456" } });
    expect(urls[0]).toBe("https://api.iranpayamak.com/ws/v1/sms/pattern");

    const unwired = smsDriver(env);
    await unwired.send("09121234567", "کد ورود", { otp: true, template: "otp", vars: { code: "123456" } });
    expect(urls[1]).toBe("https://api.iranpayamak.com/ws/v1/sms/simple");
  });
});
