import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@namilux/core";

describe("security/xss - sanitizeHtml", () => {
  it("strips script/style/event handlers and javascript: urls", () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">z</a><style>*{}</style>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<style/i);
    expect(out).toContain("hi");
  });
  it("keeps whitelisted tags and https/relative links, drops non-media img src", () => {
    const out = sanitizeHtml('<h2>t</h2><ul><li>a</li></ul><a href="https://x.ir/">ok</a><img src="https://evil/x.png" alt="a">', { allowImages: true });
    expect(out).toContain("<h2>");
    expect(out).toContain("<li>");
    expect(out).toContain('href="https://x.ir/"');
    expect(out).not.toContain("evil");
  });
  it("is idempotent (render-time re-sanitize is safe)", () => {
    const once = sanitizeHtml("<p>x</p><script>bad</script>");
    expect(sanitizeHtml(once)).toBe(once);
  });
});
