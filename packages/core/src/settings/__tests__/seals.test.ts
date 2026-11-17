import { describe, expect, it } from "vitest";
import { enamadSeal, parseSeal, samandehiSeal } from "../seals";

/**
 * The real eNamad embed, exactly as their panel hands it over (the id and Code below are the
 * shop's own, quoted here as the fixture the parser was written against - the setting itself is
 * never in this repository; the owner pastes it into `seals.enamad_code` on the box).
 */
const ENAMAD_SNIPPET =
  "<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=325898&amp;Code=UlhcSP0Kn2gkRPSWJnYv'>" +
  "<img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=325898&amp;Code=UlhcSP0Kn2gkRPSWJnYv' " +
  "alt='' style='cursor:pointer' code='UlhcSP0Kn2gkRPSWJnYv'></a>";

const ENAMAD_HREF = "https://trustseal.enamad.ir/?id=325898&Code=UlhcSP0Kn2gkRPSWJnYv";
const ENAMAD_IMG = "https://trustseal.enamad.ir/logo.aspx?id=325898&Code=UlhcSP0Kn2gkRPSWJnYv";

/** Samandehi's is one <img> whose link hides in an onclick, and whose own id attribute is letters. */
const SAMANDEHI_SNIPPET =
  "<img referrerpolicy='origin' id='ozvtfvlzsizpfvlznbqe' style='cursor:pointer' " +
  'onclick=\'window.open("https://logo.samandehi.ir/Verify.aspx?id=147258&p=xlaoaodsobpdmcsiwlbq", "Popup", ' +
  '"toolbar=no, scrollbars=no, location=no, statusbar=no, menubar=no, resizable=0, width=450, height=630, top=30")\' ' +
  "alt='logo-samandehi' src='https://logo.samandehi.ir/logo.aspx?id=147258&p=xlaoaodsobpdmcsiwlbq' />";

describe("enamadSeal", () => {
  it("reads the whole pasted snippet", () => {
    expect(enamadSeal(ENAMAD_SNIPPET)).toEqual({
      href: ENAMAD_HREF,
      img: ENAMAD_IMG,
      // The attribute the embed puts on the <img>; eNamad's own markup carries it, so ours does.
      code: "UlhcSP0Kn2gkRPSWJnYv",
    });
  });

  it("reads the bare query and the two values on their own, to the same badge", () => {
    const expected = { href: ENAMAD_HREF, img: ENAMAD_IMG, code: "UlhcSP0Kn2gkRPSWJnYv" };
    expect(enamadSeal("id=325898&Code=UlhcSP0Kn2gkRPSWJnYv")).toEqual(expected);
    expect(enamadSeal("https://trustseal.enamad.ir/?id=325898&Code=UlhcSP0Kn2gkRPSWJnYv")).toEqual(expected);
    expect(enamadSeal("  325898 UlhcSP0Kn2gkRPSWJnYv  ")).toEqual(expected);
    expect(enamadSeal("325898,UlhcSP0Kn2gkRPSWJnYv")).toEqual(expected);
  });

  it("an id with no Code still builds a badge, with no Code in it", () => {
    expect(enamadSeal("325898")).toEqual({
      href: "https://trustseal.enamad.ir/?id=325898",
      img: "https://trustseal.enamad.ir/logo.aspx?id=325898",
      code: null,
    });
  });

  it("nothing usable is null, and never a half-built URL", () => {
    for (const raw of ["", "   ", "<a href='https://trustseal.enamad.ir/'></a>", "no digits here"]) {
      expect(enamadSeal(raw)).toBeNull();
    }
  });

  it("reads only digits and alphanumerics, so nothing else reaches the URL", () => {
    const seal = enamadSeal("id=325898&Code=Ulhc\"><script>alert(1)</script>");
    expect(seal?.img).toBe("https://trustseal.enamad.ir/logo.aspx?id=325898&Code=Ulhc");
    expect(seal?.href).not.toContain("<");
  });

  it("does not read the tail of another parameter as the id", () => {
    expect(enamadSeal("?productid=999&id=325898&Code=UlhcSP0Kn2gkRPSWJnYv")?.href).toBe(ENAMAD_HREF);
  });
});

describe("samandehiSeal", () => {
  it("reads the snippet past its own alphabetic id attribute, and links to Verify.aspx", () => {
    expect(samandehiSeal(SAMANDEHI_SNIPPET)).toEqual({
      href: "https://logo.samandehi.ir/Verify.aspx?id=147258&p=xlaoaodsobpdmcsiwlbq",
      img: "https://logo.samandehi.ir/logo.aspx?id=147258&p=xlaoaodsobpdmcsiwlbq",
      // Samandehi's embed carries no `code` attribute, so neither does ours.
      code: null,
    });
  });

  it("takes the two values on their own", () => {
    expect(samandehiSeal("147258 xlaoaodsobpdmcsiwlbq")?.img).toBe(
      "https://logo.samandehi.ir/logo.aspx?id=147258&p=xlaoaodsobpdmcsiwlbq",
    );
  });

  it("is null for an empty setting", () => {
    expect(samandehiSeal("")).toBeNull();
  });
});

describe("parseSeal", () => {
  it("dispatches on the kind", () => {
    expect(parseSeal("enamad", ENAMAD_SNIPPET)?.href).toBe(ENAMAD_HREF);
    expect(parseSeal("samandehi", SAMANDEHI_SNIPPET)?.href).toContain("logo.samandehi.ir/Verify.aspx");
  });
});
