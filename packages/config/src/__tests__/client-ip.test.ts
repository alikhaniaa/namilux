import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, ipInCidrs, normalizeIp, parseCidrList } from "../client-ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIpFromHeaders", () => {
  it("reads the LAST hop of X-Forwarded-For behind a trusted proxy, never the first", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }), true)).toBe("203.0.113.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "9.9.9.9,10.0.0.1 , 203.0.113.7" }), true)).toBe("203.0.113.7");
  });
  it("falls through to X-Real-IP when X-Forwarded-For is empty, commas or garbage", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.4" }), true)).toBe("198.51.100.4");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": ", ,", "x-real-ip": "198.51.100.4" }), true)).toBe("198.51.100.4");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "<script>alert(1)</script>", "x-real-ip": "198.51.100.4" }), true)).toBe("198.51.100.4");
    expect(clientIpFromHeaders(h({}), true)).toBe("");
  });
  it("returns '' without a trusted proxy even when both headers are set", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7" }), false)).toBe("");
  });
});

describe("normalizeIp", () => {
  it("unwraps IPv4-mapped IPv6 and drops port suffixes", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("1.2.3.4:5000")).toBe("1.2.3.4");
    expect(normalizeIp(" 2001:DB8::A ")).toBe("2001:db8::a");
  });
  it("rejects garbage", () => {
    for (const bad of ["<script>", "1.2.3", "999.1.1.1", "2001:db8:::1", "::ffff:999.0.0.1", "abc", "1.2.3.4.5", ""]) {
      expect(normalizeIp(bad)).toBe("");
    }
  });
});

describe("ipInCidrs", () => {
  it("matches IPv4 CIDRs and bare addresses", () => {
    expect(ipInCidrs("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipInCidrs("10.1.2.3", ["10.0.0.0/16"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(ipInCidrs("1.2.3.5", ["1.2.3.4"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
  });
  it("matches IPv6 CIDRs and never crosses families except through ::ffff: ranges", () => {
    expect(ipInCidrs("2001:db8::5", ["2001:db8::/32"])).toBe(true);
    expect(ipInCidrs("2001:db9::5", ["2001:db8::/32"])).toBe(false);
    expect(ipInCidrs("2001:db8::5", ["10.0.0.0/8"])).toBe(false);
    expect(ipInCidrs("10.1.2.3", ["2001:db8::/32"])).toBe(false);
    expect(ipInCidrs("10.1.2.3", ["::ffff:10.0.0.0/104"])).toBe(true);
    expect(ipInCidrs("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
  });
  it("fails closed on an empty ip or a malformed CIDR", () => {
    expect(ipInCidrs("", ["0.0.0.0/0"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", ["bad/99"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", ["1.2.3.0/33"])).toBe(false);
    expect(ipInCidrs("1.2.3.4", [])).toBe(false);
  });
  it("parseCidrList accepts comma or whitespace separators and drops empties", () => {
    expect(parseCidrList(" 10.0.0.0/8, 2001:db8::/32 ,, ")).toEqual(["10.0.0.0/8", "2001:db8::/32"]);
    expect(parseCidrList(undefined)).toEqual([]);
  });
});
