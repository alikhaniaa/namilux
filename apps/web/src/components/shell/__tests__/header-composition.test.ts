import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The header is one graphite plane in two tiers (owner verdict 6 Sep 2026: the old second row read
 * as "a random part inside a premium website"). Three things made it read that way, and each of
 * them is a regression this file guards:
 *
 *  1. the nav row painted its own background, so it was a detached band rather than a tier;
 *  2. the two rows were switched with Tailwind's `md:hidden` even though components.css is imported
 *     unlayered and last, so a recipe outranks the utility - a known trap in this repo;
 *  3. the two tiers must add up to exactly the offset `.hero-under-header` pulls the home hero by,
 *     or the header's own height shows as a sliver above the photograph.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const css = read("../../../styles/components.css");
const header = read("../Header.tsx");
const desktopNav = read("../HeaderDesktopNav.tsx");

function px(pattern: RegExp): number {
  const found = pattern.exec(css);
  expect(found, `no match for ${pattern.source}`).not.toBeNull();
  return Number(found?.[1]);
}

describe("header composition", () => {
  it("switches the phone and desktop tiers in CSS, never with a Tailwind display utility", () => {
    expect(header).not.toMatch(/md:hidden/);
    expect(header).not.toMatch(/hidden md:/);
    expect(desktopNav).not.toMatch(/md:hidden|hidden md:/);
    expect(css).toMatch(/\.site-header__phone \{ display: block; \}/);
    expect(css).toMatch(/\.site-header__bar, \.site-nav \{ display: none; \}/);
    const desktop =
      /@media \(min-width: 768px\) \{\s*\.site-header__phone \{ display: none; \}\s*\.site-header__bar \{ display: block;[^}]*\}[\s\S]*?\.site-nav \{ display: block;[^}]*\}\s*\}/.exec(css);
    expect(desktop, "the 768 px block must turn the phone row off and both desktop tiers on").not.toBeNull();
  });

  it("keeps the two tiers on one plane: only the header paints a ground", () => {
    // The nav row used to carry `.frame`, which painted --frame again one layer down.
    expect(desktopNav).not.toMatch(/className="frame/);
    expect(css).not.toMatch(/\.site-nav[^{]*\{[^}]*background:/);
    // The divider is an inset shadow so it costs no height.
    expect(css).toMatch(/\.site-header__bar \{ display: block; box-shadow: inset 0 -1px 0 var\(--frame-line\); \}/);
  });

  it("adds the tier heights up to the offset the home hero is pulled under the header by", () => {
    const tierOne = px(/\.site-header__row \{[^}]*block-size: (\d+)px/);
    const tierTwo = px(/\.site-nav__row \{[^}]*block-size: (\d+)px/);
    const heroPull = px(/\.hero-under-header \{ margin-block-start: -(\d+)px/m);
    const heroPullDesktop = px(/min-width: 768px\) \{ \.hero-under-header \{ margin-block-start: -(\d+)px/);
    const phoneRow = 56; // the `h-14` phone row in Header.tsx
    expect(tierOne + tierTwo).toBe(heroPullDesktop);
    expect(heroPull).toBe(phoneRow);
    expect(header).toMatch(/className="wrap flex h-14 items-center/);
  });

  it("gives the browse tier a weight at each end, so it is not a half-empty strip", () => {
    expect(desktopNav).toMatch(/site-nav__list/);
    expect(desktopNav).toMatch(/variant="bar"/);
    expect(css).toMatch(/\.site-nav__row \{[^}]*justify-content: space-between/);
    expect(css).toMatch(/\.site-search-cue \{/);
  });
});
