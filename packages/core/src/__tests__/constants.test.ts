import { describe, expect, it } from "vitest";
import * as C from "../constants";

const entries = Object.entries(C as Record<string, unknown>);
const tuples: [string, readonly (string | number)[]][] = entries
  .filter(([, v]) => Array.isArray(v))
  .map(([k, v]) => [k, v as readonly (string | number)[]]);

describe("enum tuples", () => {
  it("enums have no duplicates", () => {
    expect(tuples.length).toBeGreaterThan(30);
    for (const [name, values] of tuples) {
      expect(new Set(values).size, name).toBe(values.length);
      expect(values.length, name).toBeGreaterThan(0);
    }
  });

  it("every string member is non-empty, trimmed and ASCII (Postgres enum labels)", () => {
    for (const [name, values] of tuples) {
      for (const v of values) {
        if (typeof v !== "string") continue;
        expect(v, `${name}:${v}`).toBe(v.trim());
        expect(v.length, `${name}:${v}`).toBeGreaterThan(0);
        // printable ASCII only: labels reach Postgres enums, cache tags and URLs
        expect(v, `${name}:${v}`).toMatch(/^[!-~][ -~]*$/);
        // ROBOTS_VALUES ("index, follow") is the one human-readable tuple; every other label is a key
        if (name !== "ROBOTS_VALUES" && name !== "SITEMAP_NAMES") {
          expect(v, `${name}:${v}`).toMatch(/^[a-z0-9][a-z0-9._/:+-]*$/i);
        }
      }
    }
  });

  it("carries the spec primary enums", () => {
    expect(C.JOB_TYPES).toContain("sms.send");
    expect(C.JOB_TYPES).toContain("reservation.expire");
    expect(C.JOB_TYPES).toContain("cache.revalidate");
    expect(C.SMS_TEMPLATES).toContain("otp");
    expect(C.SMS_TEMPLATES).toContain("product.back_in_stock");
    expect(C.BANNER_SLOTS).toEqual([
      "promo_bar",
      "home_hero",
      "home_band",
      "category_tile",
      "plp_inline",
      "pdp_band",
      "ig_landing",
    ]);
    expect(C.MENU_KEYS).toEqual(["header", "drawer", "footer_shop", "footer_help", "tabbar"]);
    expect(C.OTP_PURPOSES).toEqual(["login", "checkout", "verify_phone", "back_in_stock"]);
    expect(C.MOVEMENT_REASONS).toEqual(["sale", "restock", "adjust", "return", "cancel", "seed"]);
    expect(C.PAYMENT_STATUSES).toEqual(["initiated", "redirected", "succeeded", "failed", "expired"]);
    // `admin` joined the list with the head-admin/admin split; the older four rows stay for
    // accounts that already point at them (authz/permissions.ts holds the table).
    expect(C.ROLE_NAMES).toEqual(["owner", "admin", "instalments", "manager", "orders", "content", "support", "viewer"]);
    expect(C.SORT_KEYS[0]).toBe("recommended");
    expect(C.STATIC_TAGS).toEqual(["catalog", "settings", "content", "sitemap", "nav", "home"]);
  });

  it("ORDER_STATUSES is the account timeline order (draft first)", () => {
    expect(C.ORDER_STATUSES[0]).toBe("draft");
    expect(C.ORDER_STATUSES[1]).toBe("pending_payment");
    expect(C.ORDER_STATUSES[2]).toBe("paid");
    expect(C.ORDER_STATUSES.indexOf("shipped")).toBeGreaterThan(C.ORDER_STATUSES.indexOf("processing"));
    expect(C.ORDER_STATUSES.indexOf("delivered")).toBeGreaterThan(C.ORDER_STATUSES.indexOf("shipped"));
    expect(C.ORDER_STATUSES).toContain("expired");
  });

  it("only the whitelisted upload mime types (SVG is rejected on purpose)", () => {
    expect(C.UPLOAD_MIME_TYPES).not.toContain("image/svg+xml");
    expect([...C.UPLOAD_MIME_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4"]);
    expect(C.UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("codes and regexes", () => {
  it("UNAMBIGUOUS_ALPHABET excludes 0, O, 1, I and L", () => {
    for (const ch of "0O1IL") expect(C.UNAMBIGUOUS_ALPHABET).not.toContain(ch);
    expect(new Set(C.UNAMBIGUOUS_ALPHABET).size).toBe(C.UNAMBIGUOUS_ALPHABET.length);
    expect(C.UNAMBIGUOUS_ALPHABET).toMatch(/^[2-9A-Z]+$/);
  });

  it("ORDER_CODE_RE accepts NL-7Q2F4 and rejects NL-7Q2F0 (0 not in alphabet)", () => {
    expect(C.ORDER_CODE_RE.test("NL-7Q2F4")).toBe(true);
    expect(C.ORDER_CODE_RE.test("NL-7Q2F0")).toBe(false);
    expect(C.ORDER_CODE_RE.test("NL-7Q2FO")).toBe(false);
    expect(C.ORDER_CODE_RE.test("NL-7Q2FI")).toBe(false);
    expect(C.ORDER_CODE_RE.test("nl-7q2f4")).toBe(false);
    expect(C.ORDER_CODE_RE.test("NL-7Q2F")).toBe(false);
    expect(C.ORDER_CODE_RE.test("NL-7Q2F45")).toBe(false);
    expect(C.ORDER_CODE_RE.test("XX-7Q2F4")).toBe(false);
    expect(C.ORDER_CODE_RE.test(" NL-7Q2F4 ")).toBe(false);
    expect(C.ORDER_CODE_PREFIX + "7Q2F4").toMatch(C.ORDER_CODE_RE);
    expect(C.ORDER_CODE_LEN).toBe(5);
  });

  it("ULID_RE accepts a canonical ulid", () => {
    expect(C.ULID_RE.test("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
    expect("01ARZ3NDEKTSV4RRFFQ69G5FAV".length).toBe(C.ULID_LEN);
    expect(C.ULID_RE.test("01arz3ndektsv4rrffq69g5fav")).toBe(false);
    expect(C.ULID_RE.test("81ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false);
    expect(C.ULID_RE.test("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
    expect(C.ULID_RE.test("01ARZ3NDEKTSV4RRFFQ69G5FAVV")).toBe(false);
    for (const bad of ["I", "L", "O", "U"]) {
      expect(C.ULID_RE.test(`01ARZ3NDEKTSV4RRFFQ69G5FA${bad}`), bad).toBe(false);
    }
  });
});

describe("limits and origins", () => {
  it("every numeric limit is a positive finite integer", () => {
    const numeric: [string, number][] = entries
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => [k, v as number]);
    expect(numeric.length).toBeGreaterThan(20);
    for (const [name, value] of numeric) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it("the documented commerce and auth caps have the decided values", () => {
    expect(C.OTP_CODE_LEN).toBe(6);
    expect(C.OTP_CODE_TTL_SEC).toBe(180);
    expect(C.OTP_MAX_ATTEMPTS).toBe(5);
    expect(C.SUDO_WINDOW_MIN).toBe(5);
    expect(C.QUOTE_TTL_MIN).toBe(10);
    expect(C.PENDING_TTL_MIN_DEFAULT).toBe(30);
    expect(C.MAX_CART_LINES).toBe(20);
    expect(C.MAX_QTY_PER_LINE).toBe(99);
    expect(C.MAX_PER_ORDER_DEFAULT).toBe(5);
    expect(C.LOW_STOCK_THRESHOLD_DEFAULT).toBe(3);
    expect(C.RETURN_WINDOW_DAYS).toBe(7);
    expect(C.PLP_PAGE_SIZE).toBe(30);
    expect(C.DISPLAY_NAME_MAX).toBe(60);
    expect(C.EVENTS_RETENTION_MONTHS).toBe(13);
    expect(C.COUPON_CODE_MIN_LEN).toBeLessThan(C.COUPON_CODE_MAX_LEN);
    expect([...C.JOB_BACKOFF_MIN]).toEqual([1, 5, 25, 125]);
    expect(C.JOB_MAX_ATTEMPTS_DEFAULT).toBe(C.JOB_BACKOFF_MIN.length + 1);
  });

  it("storage keys are unique and namespaced", () => {
    const values = Object.values(C.LOCAL_KEYS);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v).toMatch(/^nl\./);
  });

  it("origins are https and limited to the decided third parties", () => {
    expect(C.CANONICAL_ORIGIN).toBe("https://namilux.ir");
    expect(C.CANONICAL_ORIGIN.endsWith("/")).toBe(false);
    for (const origin of [C.ENAMAD_IMG_ORIGIN, C.SAMANDEHI_IMG_ORIGIN, C.WHATSAPP_ORIGIN, ...C.ZARINPAL_ORIGINS]) {
      expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    }
    expect([...C.ZARINPAL_ORIGINS]).toEqual(["https://payment.zarinpal.com", "https://sandbox.zarinpal.com"]);
  });
});
