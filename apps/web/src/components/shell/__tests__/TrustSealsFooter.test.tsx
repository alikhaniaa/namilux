import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrustSealsFooter } from "../TrustSealsFooter";

// The shape `enamadSeal`/`samandehiSeal` produce: two values per badge, and eNamad's `code`
// attribute (Samandehi's embed has none, so it is null).
const ENAMAD = { href: "https://trustseal.enamad.ir/?id=1&Code=Abc123", img: "https://trustseal.enamad.ir/logo.aspx?id=1&Code=Abc123", code: "Abc123" };
const SAMANDEHI = { href: "https://logo.samandehi.ir/Verify.aspx?id=2&p=xyz", img: "https://logo.samandehi.ir/logo.aspx?id=2&p=xyz", code: null };

describe("TrustSealsFooter", () => {
  it("no seals renders nothing", () => {
    expect(renderToStaticMarkup(<TrustSealsFooter enamad={null} samandehi={null} />)).toBe("");
  });

  it("off-origin seal is dropped", () => {
    const evil = { href: "https://evil.example/?id=1", img: "https://evil.example/logo.png", code: null };
    expect(renderToStaticMarkup(<TrustSealsFooter enamad={evil} samandehi={null} />)).toBe("");
    const html = renderToStaticMarkup(<TrustSealsFooter enamad={evil} samandehi={SAMANDEHI} />);
    expect(html).not.toContain("evil.example");
    expect(html).toContain("logo.samandehi.ir");
  });

  it("one valid seal renders alone, both render both", () => {
    const one = renderToStaticMarkup(<TrustSealsFooter enamad={ENAMAD} samandehi={null} />);
    expect(one).toContain("trustseal.enamad.ir");
    expect(one).not.toContain("samandehi");
    const both = renderToStaticMarkup(<TrustSealsFooter enamad={ENAMAD} samandehi={SAMANDEHI} />);
    expect(both).toContain("trustseal.enamad.ir");
    expect(both).toContain("logo.samandehi.ir");
    // "origin", not "no-referrer": the seal's own server draws the badge only for a request whose
    // Referer it recognises, and "origin" is the least it can be given (the site root, no path).
    expect(both.toLowerCase()).toContain('referrerpolicy="origin"');
    expect(both.toLowerCase()).not.toContain('referrerpolicy="no-referrer"');
    // On the anchor as well as the image: the verification page reads the same header, and both
    // carry it in eNamad's own embed.
    expect(both).toContain('<a href="https://trustseal.enamad.ir/?id=1&amp;Code=Abc123" target="_blank" rel="noopener" referrerPolicy="origin"');
    // noreferrer overrides referrerPolicy and breaks provider domain verification on click.
    expect(both).not.toContain("noreferrer");
    // eNamad's <img> carries `code`; Samandehi's does not, so ours must not invent one.
    expect(both).toContain('code="Abc123"');
    expect(both.match(/code="/g)).toHaveLength(1);
  });
});
