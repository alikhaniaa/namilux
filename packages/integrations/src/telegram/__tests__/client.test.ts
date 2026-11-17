import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, formatEvent, telegramClient } from "../client";

describe("telegram", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled and never sends without config", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = telegramClient(null);
    expect(client.enabled).toBe(false);
    expect(await client.send("hi")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the configured chat only, with escaped HTML", async () => {
    let body: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect((url as string)).toContain("/botTOKEN/sendMessage");
      body = JSON.parse((init?.body as string)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = telegramClient({ botToken: "TOKEN", chatId: "-100" });
    expect(await client.send("hello")).toBe(true);
    expect(body!.chat_id).toBe("-100");
    expect(body!.parse_mode).toBe("HTML");
  });

  it("escapeHtml neutralises angle brackets and ampersands", () => {
    expect(escapeHtml("<b>&x")).toBe("&lt;b&gt;&amp;x");
  });

  it("formatEvent escapes hostile field values", () => {
    const text = formatEvent("contact.message", { subject: "<script>alert(1)</script>" });
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
  });

  it("formatEvent masks a phone in admin.login and never leaks a full number", () => {
    const text = formatEvent("admin.login", { phone: "09121234567" });
    expect(text).toContain("0912***4567");
    expect(text).not.toMatch(/09121234567/);
  });

  it("formatEvent shows the order code and total for order.paid", () => {
    const text = formatEvent("order.paid", { code: "NL-ABCDE", total: 41500000, city: "تهران" });
    expect(text).toContain("NL-ABCDE");
    expect(text).toContain("تومان");
  });
});
