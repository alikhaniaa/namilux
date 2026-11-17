import { afterEach, describe, expect, it, vi } from "vitest";
import { farazsmsDriver, normalizeRecipient } from "../farazsms";
import { parsePatterns } from "../registry";

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const cfg = { apiKey: "KEY-1", lineNumber: "90008361", unitCostToman: 1_500 };
const withPattern = { ...cfg, patterns: { otp: "SJ3FgPrE0C", "order.paid": "PAID1234" } as const };
const zeroVarPattern = { ...cfg, patterns: { "customer.welcome": "95DOACyydm" } as const };
const shortVarPattern = { ...cfg, patterns: { "contact.reply": "wQ9KkrCmAs", "order.shipped": "j7ZXDIMJt1" } as const };
const bodyOf = (i: number): Record<string, unknown> => JSON.parse(calls[i]?.init?.body as string) as Record<string, unknown>;
const headerOf = (i: number, k: string): string | undefined => (calls[i]?.init?.headers as Record<string, string> | undefined)?.[k];

describe("farazsms recipients", () => {
  it("normalises to the 09xxxxxxxxx form their API demands", () => {
    expect(normalizeRecipient("09121234567")).toBe("09121234567");
    expect(normalizeRecipient("+989121234567")).toBe("09121234567");
    expect(normalizeRecipient("00989121234567")).toBe("09121234567");
    expect(normalizeRecipient("989121234567")).toBe("09121234567");
    expect(normalizeRecipient("0912 123 4567")).toBe("09121234567");
    expect(normalizeRecipient("02112345678")).toBeNull();
    expect(normalizeRecipient("0912123456")).toBeNull();
  });
});

describe("parsePatterns", () => {
  it("reads the env map and shrugs off anything malformed", () => {
    expect(parsePatterns('{"otp":"A1","order.paid":"B2"}')).toEqual({ otp: "A1", "order.paid": "B2" });
    expect(parsePatterns(undefined)).toEqual({});
    expect(parsePatterns("")).toEqual({});
    expect(parsePatterns("not json")).toEqual({});
    expect(parsePatterns("[1,2]")).toEqual({});
    // a blank code is the same as no pattern - it must not be offered to the pattern route
    expect(parsePatterns('{"otp":"","order.paid":"B2"}')).toEqual({ "order.paid": "B2" });
  });
});

describe("farazsms driver", () => {
  it("accepts the live API's object-shaped send answer (data.id) as a queued send", async () => {
    stubFetch({ status: "success", message: "", data: { id: 13358058, type: "pattern", status: "in-queue" } }, 200);
    const r = await farazsmsDriver(withPattern).send("09121234567", "کد ورود نامی‌لوکس: ۱۲۳۴", {
      otp: true,
      template: "otp",
      vars: { code: "1234" },
    });
    expect(r).toMatchObject({ ok: true, providerRef: "13358058" });
  });

  it("sends a configured template through the instant pattern route", async () => {
    stubFetch({ status: "success", data: 5512345, messages: null }, 201);
    const r = await farazsmsDriver(withPattern).send("09121234567", "کد ورود نامی‌لوکس: ۱۲۳۴", {
      otp: true,
      template: "otp",
      vars: { code: "1234" },
    });
    expect(r).toMatchObject({ ok: true, providerRef: "5512345" });
    expect(calls[0]?.url).toBe("https://api.iranpayamak.com/ws/v1/sms/pattern");
    expect(headerOf(0, "Api-Key")).toBe("KEY-1");
    expect(bodyOf(0)).toEqual({
      code: "SJ3FgPrE0C",
      recipient: "09121234567",
      attributes: { code: "1234" },
      line_number: "90008361",
      number_format: "english",
    });
  });

  it("stringifies every attribute - their variables are strings", async () => {
    stubFetch({ status: "success", data: 1, messages: null }, 201);
    await farazsmsDriver(withPattern).send("09121234567", "x", { template: "order.paid", vars: { code: "NL-7Q2F4", eta: 3 } });
    expect(bodyOf(0)["attributes"]).toEqual({ code: "NL-7Q2F4", eta: "3" });
  });

  it("uses the pattern route for a pattern that declares NO variables", async () => {
    // customer.welcome (95DOACyydm) has an empty attribute list. An empty map is a map: demoting it
    // to the free-text route would put every welcome message in front of a human moderator.
    stubFetch({ status: "success", data: { id: 13469464, type: "pattern", status: "in-queue" } }, 200);
    const r = await farazsmsDriver(zeroVarPattern).send("09121230077", "به نامی‌لوکس خوش آمدید.", {
      template: "customer.welcome",
      vars: {},
    });
    expect(r).toMatchObject({ ok: true, providerRef: "13469464" });
    expect(calls[0]?.url).toBe("https://api.iranpayamak.com/ws/v1/sms/pattern");
    expect(bodyOf(0)).toEqual({
      code: "95DOACyydm",
      recipient: "09121230077",
      attributes: {},
      line_number: "90008361",
      number_format: "english",
    });
  });

  it("truncates every variable to the length the panel declares", async () => {
    // Over-length is not an error: FarazSMS answers `success` and quietly sends the message to
    // moderation instead. contact.reply declares `answer` at 25 characters.
    stubFetch({ status: "success", data: 1, messages: null }, 201);
    const long = "ب".repeat(80);
    await farazsmsDriver(shortVarPattern).send("09121234567", "x", { template: "contact.reply", vars: { answer: long } });
    const answer = (bodyOf(0)["attributes"] as Record<string, string>)["answer"] ?? "";
    expect([...answer]).toHaveLength(25);
    expect(answer.endsWith("…")).toBe(true);

    // A value inside its limit is untouched, and each variable is cut to its own limit.
    calls.length = 0;
    stubFetch({ status: "success", data: 2, messages: null }, 201);
    await farazsmsDriver(shortVarPattern).send("09121234567", "x", {
      template: "order.shipped",
      vars: { code: "NL-7Q2F4", carrier: "پ".repeat(40), tracking: "1234567890" },
    });
    const attrs = bodyOf(0)["attributes"] as Record<string, string>;
    expect(attrs["code"]).toBe("NL-7Q2F4"); // 8 of the 10 characters `code` declares
    expect(attrs["tracking"]).toBe("1234567890");
    expect([...(attrs["carrier"] ?? "")]).toHaveLength(25); // their reviewer caps every variable at 25
  });

  it("sends the order code under the name its pattern declares, `sefaresh`, at its own limit", async () => {
    // The three order patterns declare the order code as `sefaresh` (str 10). Under the name
    // `code` their reviewer rewrites it to a 6-digit int, which NL-XXXXX does not fit - and a value
    // that does not fit is not an error, it is a silent detour into the moderation queue.
    stubFetch({ status: "success", data: 9, messages: null }, 201);
    await farazsmsDriver({ ...cfg, patterns: { "order.placed_pending": "BMLSGWOKp6" } }).send("09121234567", "x", {
      template: "order.placed_pending",
      vars: { sefaresh: "NL-7Q2F4" },
    });
    const attrs = bodyOf(0)["attributes"] as Record<string, string>;
    expect(attrs).toEqual({ sefaresh: "NL-7Q2F4" }); // all 8 characters, uncut, and no `code` key
    expect(calls[0]?.url).toContain("/ws/v1/sms/pattern");
  });

  it("leaves a variable alone when the template declares no limit for it", async () => {
    stubFetch({ status: "success", data: 3, messages: null }, 201);
    const text = "ت".repeat(90);
    await farazsmsDriver({ ...cfg, patterns: { campaign: "CMP1" } }).send("09121234567", "x", { template: "campaign", vars: { text, unsub: "11" } });
    expect((bodyOf(0)["attributes"] as Record<string, string>)["text"]).toBe(text);
  });

  it("falls back to the free-text route when no pattern is registered", async () => {
    stubFetch({ status: "success", data: 777, messages: null }, 201);
    const r = await farazsmsDriver(withPattern).send("09121234567", "سفارش شما ارسال شد", {
      template: "order.shipped",
      vars: { code: "NL-1" },
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://api.iranpayamak.com/ws/v1/sms/simple");
    expect(bodyOf(0)).toEqual({
      text: "سفارش شما ارسال شد",
      recipients: ["09121234567"],
      line_number: "90008361",
      number_format: "english",
    });
  });

  it("costs the send by segment so the daily budget has something to count", async () => {
    stubFetch({ status: "success", data: 1, messages: null }, 201);
    // Persian text is UCS-2: 70 chars per segment, so this two-segment message costs twice the rate.
    const twoSegments = "ن".repeat(80);
    const r = await farazsmsDriver(cfg).send("09121234567", twoSegments);
    expect(r).toMatchObject({ ok: true, segments: 2, costToman: 3_000 });
  });

  it("treats status:error in a 200 body as a failure", async () => {
    // Their own docs: check `status`, not just the HTTP code.
    stubFetch({ status: "error", data: null, messages: "اعتبار کافی نیست" }, 200);
    const r = await farazsmsDriver(cfg).send("09121234567", "x");
    expect(r).toEqual({ ok: false, error: "اعتبار کافی نیست", retryable: false });
  });

  it("does not retry a business rejection but does retry a throttle", async () => {
    stubFetch({ status: "error", data: null, messages: { code: ["فیلد code باید ارسال شود"] } }, 400);
    const bad = await farazsmsDriver(withPattern).send("09121234567", "x", { template: "otp", vars: { code: "1" } });
    expect(bad).toEqual({ ok: false, error: "فیلد code باید ارسال شود", retryable: false });

    calls.length = 0;
    stubFetch({ status: "error", data: null, messages: "Too Many Requests" }, 429);
    const throttled = await farazsmsDriver(cfg).send("09121234567", "x");
    expect(throttled).toMatchObject({ ok: false, retryable: true });
  });

  it("rejects a recipient their API would refuse, without calling out", async () => {
    stubFetch({ status: "success", data: 1 }, 201);
    const r = await farazsmsDriver(cfg).send("02112345678", "x");
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(calls).toHaveLength(0);
  });

  it("declares the 60/min limit so a campaign can pace itself", () => {
    expect(farazsmsDriver(cfg).maxPerMinute).toBe(60);
  });

  it("reads the balance and maps delivery status", async () => {
    stubFetch({ status: "success", message: null, data: { balanceAmount: 5000, balanceCount: 25, details: [{ count: 25, rate: 200, amount: 5000 }] } });
    expect(await farazsmsDriver(cfg).balance?.()).toBe(5000);

    // What the live API actually answers: snake_case, and the amount as a string.
    calls.length = 0;
    stubFetch({ status: "success", message: "", data: { balance_amount: "14054292", balance_count: "65066.16" } });
    expect(await farazsmsDriver(cfg).balance?.()).toBe(14_054_292);

    calls.length = 0;
    stubFetch({ status: "success", data: [{ status: "delivered" }] });
    expect(await farazsmsDriver(cfg).status?.("5512345")).toBe("delivered");
    expect(calls[0]?.url).toBe("https://api.iranpayamak.com/ws/v1/send_request/5512345/items");

    calls.length = 0;
    stubFetch({ status: "success", data: { items: [{ status: "pending-approval" }] } });
    // Held for a moderator is accepted-not-delivered, which is "sent", not a failure.
    expect(await farazsmsDriver(cfg).status?.("1")).toBe("sent");
  });

  it("reads the paginated `data.data` rows the live items endpoint actually returns", async () => {
    // Measured on request 13516964 (7 Sep 2026): their items endpoint paginates and puts the rows
    // under data.data, not data.items. Reading only `items` made every ref answer "unknown" - and
    // this is the one call that distinguishes accepted from delivered, the very trap that let two
    // days of rejected free-text sends look fine.
    stubFetch({
      status: "success",
      message: "با موفقیت انجام شد.",
      data: { current_page: 1, data: [{ id: 181_711_804, status: "delivered", pages: "2" }], last_page: 1 },
    });
    expect(await farazsmsDriver(cfg).status?.("13516964")).toBe("delivered");
  });

  it("«undelivered» is a failure, not a delivery", async () => {
    // The word contains "delivered", so a success-first test read every undeliverable message - 
    // wrong number, blacklisted, operator reject - as delivered, and the SMS log said so.
    for (const status of ["undelivered", "Undelivered", "failed", "rejected", "blacklisted"]) {
      calls.length = 0;
      stubFetch({ status: "success", data: { data: [{ status }] } });
      expect(await farazsmsDriver(cfg).status?.("1")).toBe("failed");
    }
  });

  it("a dead gateway is a retryable failure, never a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    const r = await farazsmsDriver(cfg).send("09121234567", "x");
    expect(r).toMatchObject({ ok: false, retryable: true });
  });
});

describe("farazsms - the instalment site's own patterns", () => {
  const both = { ...cfg, patterns: { "order.shipped": "MAIN00001", "order.shipped@instalments": "INST00001", "order.expired": "MAIN00002" } };

  it("sends the instalment wording by its own code", async () => {
    stubFetch({ status: "success", data: { id: 1, type: "pattern", status: "in-queue" } }, 200);
    await farazsmsDriver(both).send("09121234567", "x", { template: "order.shipped", patternKey: "order.shipped@instalments", vars: { code: "NL-7Q2F4", carrier: "post", tracking: "RB1" } });
    expect(calls[0]?.url).toContain("/ws/v1/sms/pattern");
    expect(bodyOf(0)).toMatchObject({ code: "INST00001", attributes: { code: "NL-7Q2F4", carrier: "post", tracking: "RB1" } });
  });

  it("falls back to free text, never to the main pattern, when the instalment code is missing", async () => {
    stubFetch({ status: "success", data: 7 }, 200);
    await farazsmsDriver(both).send("09121234567", "sefaresh NL-7Q2F4 namilux2.ir/account", { template: "order.expired", patternKey: "order.expired@instalments", vars: { sefaresh: "NL-7Q2F4" } });
    expect(calls[0]?.url).toContain("/ws/v1/sms/simple");
    expect(bodyOf(0)).toMatchObject({ text: "sefaresh NL-7Q2F4 namilux2.ir/account" });
  });

  it("parsePatterns keeps the @instalments keys", () => {
    expect(parsePatterns('{"order.shipped":"A","order.shipped@instalments":"B"}')).toEqual({ "order.shipped": "A", "order.shipped@instalments": "B" });
  });
});
