import { describe, expect, it } from "vitest";
import sharp from "sharp";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
import { OG, SITE_OG_LABEL, escapeSvgText, ogCard, ogColorsFromTokens, ogKey, ogSvgOverlay } from "../og-card.js";

const colors = ogColorsFromTokens(tokens);

async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const p = (y * info.width + x) * info.channels;
  return [data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0];
}

const hex = (s: string): [number, number, number] => [
  Number.parseInt(s.slice(1, 3), 16),
  Number.parseInt(s.slice(3, 5), 16),
  Number.parseInt(s.slice(5, 7), 16),
];

const close = (a: [number, number, number], b: [number, number, number], tol = 3): boolean =>
  a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tol);

describe("ogColorsFromTokens", () => {
  it("reads the five light-theme values from tokens.json", () => {
    const light = (tokens as { themes: { light: Record<string, string> } }).themes.light;
    expect(colors).toEqual({
      bg: light.bg,
      surface: light.surface,
      ink: light.ink,
      ink3: light["ink-3"],
      accent: light.accent,
    });
  });

  it("accepts a bare light-theme object too", () => {
    // values come from the tokens package, never from literals in a test
    const light = (tokens as { themes: { light: Record<string, string> } }).themes.light;
    expect(ogColorsFromTokens({ ...light })).toEqual(colors);
  });

  it("throws when a colour is missing", () => {
    const light = (tokens as { themes: { light: Record<string, string> } }).themes.light;
    expect(() => ogColorsFromTokens({ themes: { light: { bg: light.bg } } })).toThrow(/OG colour/);
    expect(() => ogColorsFromTokens(null)).toThrow(/OG colour/);
  });
});

describe("escapeSvgText", () => {
  it("escapes the five XML characters", () => {
    expect(escapeSvgText(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &#39; f");
  });
});

describe("ogSvgOverlay", () => {
  it("uses the with-image geometry and the token colours", () => {
    const svg = ogSvgOverlay({ label: "قهوه‌ساز", withImage: true, colors });
    expect(svg).toContain(`width="${OG.W}" height="${OG.H}"`);
    expect(svg).toContain(`y="${OG.label.y}"`);
    expect(svg).toContain(`font-size="${OG.label.size}"`);
    expect(svg).toContain(`fill="${colors.ink}"`);
    // exactly one accent occurrence: the square of the mark
    expect(svg.split(colors.accent).length - 1).toBe(1);
    expect(svg).toContain("<rect");
    expect(svg).toContain(OG.mark.wordmark);
  });

  it("switches to the larger typographic geometry without an image", () => {
    const svg = ogSvgOverlay({ label: "نامی‌لوکس", withImage: false, colors });
    expect(svg).toContain(`y="${OG.label.yNoImage}"`);
    expect(svg).toContain(`font-size="${OG.label.sizeNoImage}"`);
  });

  it("truncates a long label at a word boundary", () => {
    const label = "سشوار دایسون سوپرسونیک نانو مدل کامل با تمام سری‌ها و جعبه اصلی و گارانتی معتبر شرکتی";
    const svg = ogSvgOverlay({ label, withImage: true, colors });
    const text = svg.slice(svg.indexOf(">", svg.indexOf("<text")) + 1, svg.indexOf("</text>"));
    expect(text.length).toBeLessThanOrEqual(OG.label.maxChars);
    expect(text.endsWith("…")).toBe(true);
    // never mid-word: the kept prefix is a whole-word prefix of the original
    expect(label.startsWith(text.slice(0, -1))).toBe(true);
  });

  it("isolates a Latin model code and keeps its Latin digits", () => {
    const svg = ogSvgOverlay({ label: "سشوار دایسون KLF04 · مشکی", withImage: true, colors });
    expect(svg).toContain('<tspan direction="ltr" unicode-bidi="isolate">');
    expect(svg).toContain("KLF04");
  });

  it("converts free-standing digits to Persian", () => {
    const svg = ogSvgOverlay({ label: "چای‌ساز 2 لیتری", withImage: true, colors });
    expect(svg).toContain("۲");
  });

  it("escapes markup in the label", () => {
    const svg = ogSvgOverlay({ label: "Smeg & <script>", withImage: true, colors });
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });
});

describe("ogKey", () => {
  it("mirrors the store key layout", () => {
    expect(ogKey("product", 1044)).toBe("og/p/1044.jpg");
    expect(ogKey("brand", "dyson")).toBe("og/b/dyson.jpg");
    expect(ogKey("collection", "gifts")).toBe("og/c/gifts.jpg");
    expect(ogKey("site", "site")).toBe("og/site.jpg");
  });
});

describe("ogCard", () => {
  it("rasterises 1200×630 JPEG with a white plinth over the porcelain ground", async () => {
    const master = await sharp({
      create: { width: 1600, height: 2000, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 24, g: 26, b: 28 } } })
            .png()
            .toBuffer(),
          left: 500,
          top: 320,
        },
      ])
      .png()
      .toBuffer();

    const card = await ogCard({ kind: "product", label: "ایرپ دایسون", image: master });
    const meta = await sharp(card).metadata();
    expect([meta.width, meta.height]).toEqual([OG.W, OG.H]);
    expect(meta.format).toBe("jpeg");
    expect(meta.hasAlpha).toBe(false);

    // ground outside the plinth is --bg; inside the plinth (above the product box) is --surface
    expect(close(await pixel(card, 20, 20), hex(colors.bg))).toBe(true);
    expect(close(await pixel(card, OG.W / 2, OG.plinth.top + 8), hex(colors.surface))).toBe(true);
  });

  it("renders the typographic variant when there is no image", async () => {
    const card = await ogCard({ kind: "site", label: SITE_OG_LABEL, image: null });
    const meta = await sharp(card).metadata();
    expect([meta.width, meta.height]).toEqual([OG.W, OG.H]);
    // no plinth: the whole upper band stays --bg
    expect(close(await pixel(card, OG.W / 2, OG.plinth.top + 8), hex(colors.bg))).toBe(true);
  });

  it("contains a source narrower than the product box instead of upscaling it", async () => {
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 24, g: 26, b: 28 } },
    })
      .png()
      .toBuffer();
    const card = await ogCard({ kind: "brand", label: "دایسون", image: small });
    expect((await sharp(card).metadata()).width).toBe(OG.W);
    // the 300×200 source sits centred on the plinth, so the plinth edge is still --surface
    expect(close(await pixel(card, OG.W / 2 - 380 + 8, OG.plinth.top + 8), hex(colors.surface))).toBe(true);
    // …and its dark pixels are at the centre, not stretched to the box edges
    const [r] = await pixel(card, OG.W / 2, OG.product.top + Math.round(OG.product.h / 2));
    expect(r).toBeLessThan(80);
  });
});
