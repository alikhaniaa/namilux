import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PAIRS, parseTokensCss, ratio, run } from "../contrast-check.mjs";
import { COLORS, GLYPH_FILE, IOS_SPLASH, SIZES, main as makeIcons, splashFile, splashMedia } from "../scripts/make-icons.mjs";
import { BUDGETS, COMMANDS, OUTPUTS, UNICODE_RANGES } from "../scripts/subset-fonts.mjs";
import tokens from "../tokens.json";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const CSS_PATH = path.join(PKG, "tokens.css");

const read = (p: string) => fs.readFileSync(p, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The shape contrast-check.mjs documents for parseTokensCss (its JS inference is untyped). */
type ParsedTokensCss = {
  root: Record<string, string>;
  dark: Record<string, string>;
  plateFrame: Record<string, string>;
  frame: Record<string, string>;
  focusVisible: string;
};
function parseCss(cssText: string): ParsedTokensCss {
  const parsed: unknown = parseTokensCss(cssText);
  return parsed as ParsedTokensCss;
}

const light = tokens.themes.light as Record<string, string>;
const dark = tokens.themes.dark as Record<string, string>;

/** `U+0600-06FF,U+200C` → [[0x600, 0x6ff], [0x200c, 0x200c]] */
function unicodeRanges(spec: string): [number, number][] {
  return spec.split(",").map((raw) => {
    const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/u.exec(raw.trim());
    expect(m, `not a unicode-range token: ${raw}`).not.toBeNull();
    const lo = Number.parseInt(String(m?.[1]), 16);
    const hiRaw = m?.[2];
    return [lo, hiRaw === undefined ? lo : Number.parseInt(hiRaw, 16)];
  });
}
const covers = (ranges: [number, number][], cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

describe("contrast gate", () => {
  it("run() reports 0 failures and 2 × PAIRS.length pair results", () => {
    const result = run();
    expect(result.sync).toEqual([]);
    expect(result.failures).toBe(0);
    expect(result.pairs).toHaveLength(2 * PAIRS.length);
    expect(result.pairs.filter((p) => p.theme === "light")).toHaveLength(PAIRS.length);
    expect(result.pairs.filter((p) => p.theme === "dark")).toHaveLength(PAIRS.length);
    expect(result.pairs.every((p) => p.pass)).toBe(true);
  });

  it("ratio matches known values: ink on bg light 16.23, plate vs bg light 1.23, plate vs bg dark 13.65 (UI v4 warm porcelain)", () => {
    expect(ratio(String(light.ink), String(light.bg))).toBeCloseTo(16.23, 2);
    expect(ratio(String(light.plate), String(light.bg))).toBeCloseTo(1.23, 2);
    expect(ratio(String(dark.plate), String(dark.bg))).toBeCloseTo(13.65, 2);
    // the formula is symmetric and self-identical
    expect(ratio("#FFFFFF", "#000000")).toBeCloseTo(21, 6);
    expect(ratio(String(light.bg), String(light.bg))).toBeCloseTo(1, 6);
  });

  it("PAIRS cover every 'verified pair' named in the spec (ink, ink-2, ink-3, accent text, accent-ink, frame-ink-2, frame-accent, line-input, plate-ink, plate vs bg, state colours)", () => {
    const declared = new Set(PAIRS.map((p) => `${String(p[1])} on ${String(p[2])}`));
    const required = [
      ["ink", "bg"],
      ["ink-2", "bg"],
      ["ink-3", "bg"],
      ["ink-3", "bg-soft"],
      ["accent", "bg"],
      ["accent-ink", "accent"],
      ["frame-ink-2", "frame"],
      ["frame-accent", "frame"],
      ["line-input", "bg"],
      ["plate-ink", "plate"],
      ["plate", "bg"],
      // state colours «≥ 5.0 on both grounds»
      ["ok", "bg"],
      ["ok", "surface"],
      ["warn", "bg"],
      ["warn", "surface"],
      ["danger", "bg"],
      ["danger", "surface"],
    ];
    for (const [fg, bg] of required) expect(declared, `${fg} on ${bg}`).toContain(`${fg} on ${bg}`);
  });

  it("parseTokensCss strips comments and reads :root, html.dark, `.plate, .frame`, `.frame`, :focus-visible", () => {
    const sample = [
      "/* a header comment that mentions --bg: #000000; and { braces } */",
      ":root { --bg: #FFFFFF; /* 16.5:1 */ --focus: var(--accent); }",
      "html.dark { --bg: #000000; color-scheme: dark; }",
      ".plate, .frame { --focus: var(--plate-ink); }",
      ".frame { --focus: var(--frame-accent); }",
      ":focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }",
    ].join("\n");
    const parsed = parseCss(sample);
    expect(parsed.root).toEqual({ bg: "#FFFFFF", focus: "var(--accent)" });
    expect(parsed.dark).toEqual({ bg: "#000000" });
    expect(parsed.plateFrame).toEqual({ focus: "var(--plate-ink)" });
    expect(parsed.frame).toEqual({ focus: "var(--frame-accent)" });
    expect(parsed.focusVisible).toBe("outline: 2px solid var(--focus); outline-offset: 2px;");
  });

  it("sync detects a drifted value (copy of tokens.css with --bg changed → one SYNC line)", () => {
    const real = read(CSS_PATH);
    const drifted = real.replace(/--bg:(\s+)#F6F4EF;/u, "--bg:$1#F7F5F0;");
    expect(drifted).not.toBe(real); // the drift must actually apply, never write it back to disk

    const original = fs.readFileSync;
    const patched = ((file: unknown, options: unknown) =>
      typeof file === "string" && file.endsWith("tokens.css")
        ? drifted
        : (original as (f: unknown, o: unknown) => unknown)(file, options)) as unknown as typeof fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(patched);
    try {
      const result = run();
      expect(result.sync).toHaveLength(1);
      expect(String(result.sync[0])).toMatch(/:root --bg = #F7F5F0; tokens\.json light = #F6F4EF/u);
      expect(result.failures).toBe(1);
    } finally {
      spy.mockRestore();
    }
    // the file on disk is untouched
    expect(read(CSS_PATH)).toBe(real);
  });
});

describe("tokens.json invariants", () => {
  it("plate-ink / plate-ink-2 / plate-chip identical across themes", () => {
    for (const key of ["plate-ink", "plate-ink-2", "plate-chip"]) expect(dark[key], key).toBe(light[key]);
  });

  it("all colour values are uppercase #RRGGBB", () => {
    for (const theme of [light, dark]) {
      for (const [key, value] of Object.entries(theme)) expect(value, key).toMatch(/^#[0-9A-F]{6}$/u);
    }
  });

  it("spacing is the fixed scale (4 8 12 16 24 32 48 64 96 128 160) under --s-1 … --s-11", () => {
    const steps = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160];
    const spacing = tokens.spacing as Record<string, string>;
    expect(Object.keys(spacing)).toEqual(steps.map((_, i) => `s-${i + 1}`));
    steps.forEach((px, i) => expect(spacing[`s-${i + 1}`]).toBe(`${px}px`));
  });

  it("breakpoints are sm 480, md 768, lg 1024, xl 1280", () => {
    expect(tokens.breakpoints).toEqual({ sm: 480, md: 768, lg: 1024, xl: 1280 });
  });

  it("manifest.theme_color and background_color equal themes.light.frame (#15181A)", () => {
    expect(light.frame).toBe("#15181A");
    expect(tokens.manifest.theme_color).toBe(light.frame);
    expect(tokens.manifest.background_color).toBe(light.frame);
  });

  it("warmFallback has exactly the six ground keys and is not the active palette", () => {
    const warm = tokens.warmFallback as Record<string, string>;
    const colourKeys = Object.keys(warm).filter((k) => k !== "note");
    expect(colourKeys).toEqual(["bg", "surface", "bg-soft", "plate", "line", "line-2"]);
    for (const key of colourKeys) {
      expect(warm[key], key).toMatch(/^#[0-9A-F]{6}$/u);
      expect(warm[key]).not.toBe(light[key]);
    }
  });

  it("font.font-sans is the Estedad stack; weights 400/500/600/700/800", () => {
    expect(tokens.font["font-sans"]).toBe('"Estedad", "Vazirmatn", "Segoe UI", Tahoma, sans-serif');
    expect(tokens.font.family).toBe("Estedad");
    expect(tokens.font.fallback).toBe("Vazirmatn");
    expect(tokens.font.weights).toEqual({ body: 400, ui: 500, label: 600, price: 700, display: 800 });
  });
});

describe("tokens.css", () => {
  const css = read(CSS_PATH);
  const parsed = parseCss(css);

  it("html.dark overrides every colour key and only colour keys (+ --focus, color-scheme)", () => {
    expect(new Set(Object.keys(parsed.dark))).toEqual(new Set([...Object.keys(dark), "focus"]));
    const body = /html\.dark\s*\{([^}]*)\}/u.exec(stripComments(css))?.[1] ?? "";
    const plain = body
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && !d.startsWith("--"));
    expect(plain).toEqual(["color-scheme: dark"]);
  });

  it(":root declares --focus: var(--accent); `.plate, .frame` → var(--plate-ink); `.frame` → var(--frame-accent)", () => {
    expect(parsed.root.focus).toBe("var(--accent)");
    expect(parsed.dark.focus).toBe("var(--accent)");
    expect(parsed.plateFrame.focus).toBe("var(--plate-ink)");
    expect(parsed.frame.focus).toBe("var(--frame-accent)");
    expect(tokens.focus).toMatchObject({
      root: "var(--accent)",
      plate: "var(--plate-ink)",
      frame: "var(--frame-accent)",
    });
    // `.frame` must come after `.plate, .frame` so the frame wins on the frame itself
    expect(css.indexOf(".frame { --focus: var(--frame-accent); }")).toBeGreaterThan(css.indexOf(".plate, .frame {"));
  });

  it(":focus-visible is `outline: 2px solid var(--focus); outline-offset: 2px`", () => {
    expect(parsed.focusVisible).toBe("outline: 2px solid var(--focus); outline-offset: 2px;");
    expect(tokens.focus.outline).toBe("2px solid var(--focus)");
    expect(tokens.focus["outline-offset"]).toBe("2px");
  });

  it("no rgb()/hex outside the declared tokens (every colour literal in the file is a token value)", () => {
    const body = stripComments(css);
    const declared = new Set([...Object.values(light), ...Object.values(dark)]);
    const hexes = [...body.matchAll(/#[0-9A-Fa-f]{3,8}/gu)].map((m) => m[0]);
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(declared.has(hex.toUpperCase()), hex).toBe(true);
    // the only rgb() literals are inside the two shadow tokens
    const shadows = Object.values(tokens.shadow as Record<string, string>).join(" ");
    const rgbs = [...body.matchAll(/rgba?\([^)]*\)/gu)].map((m) => m[0]);
    expect(rgbs.length).toBeGreaterThan(0);
    for (const rgb of rgbs) expect(shadows, rgb).toContain(rgb);
  });
});

describe("fonts", () => {
  const ranges = unicodeRanges(UNICODE_RANGES);

  it("UNICODE_RANGES include U+200C (ZWNJ), U+06F0-06F9 (Persian digits), U+066C, U+00AB/U+00BB", () => {
    expect(covers(ranges, 0x200c), "ZWNJ U+200C").toBe(true);
    for (let cp = 0x06f0; cp <= 0x06f9; cp += 1) expect(covers(ranges, cp), `U+${cp.toString(16)}`).toBe(true);
    expect(covers(ranges, 0x066c), "U+066C thousands separator").toBe(true);
    expect(covers(ranges, 0x00ab), "U+00AB «").toBe(true);
    expect(covers(ranges, 0x00bb), "U+00BB »").toBe(true);
    // deliberately dropped (fonts/README.md "Deliberately dropped")
    expect(covers(ranges, 0x0750), "U+0750 Arabic Supplement").toBe(false);
    expect(covers(ranges, 0xfb50), "U+FB50 Presentation Forms-A").toBe(false);
  });

  it("budgets: Estedad 110 KB, Vazirmatn 60 KB", () => {
    expect(BUDGETS.estedad).toBe(110 * 1024);
    expect(BUDGETS.estedad).toBe(112_640);
    expect(BUDGETS.vazirmatn).toBe(60 * 1024);
    expect(BUDGETS.vazirmatn).toBe(61_440);
  });

  it("COMMANDS keep --layout-features=* and --flavor=woff2 on both subset steps", () => {
    const subsets = COMMANDS.filter((c) => c.tool === "subset");
    expect(subsets).toHaveLength(2);
    for (const cmd of subsets) {
      expect(cmd.args).toContain("--layout-features=*");
      expect(cmd.args).toContain("--flavor=woff2");
      expect(cmd.args).toContain(`--unicodes=${UNICODE_RANGES}`);
    }
    const instances = COMMANDS.filter((c) => c.tool === "instancer");
    expect(instances).toHaveLength(2);
    for (const cmd of instances) expect(cmd.args).toContain("wght=400:800");
  });

  it("fallbackMetrics are the measured Vazirmatn-for-Estedad overrides (106.38 / 96.36 / 47.00 / 0)", () => {
    expect(tokens.font.fallbackMetrics).toMatchObject({
      "size-adjust": "106.38%",
      "ascent-override": "96.36%",
      "descent-override": "47.00%",
      "line-gap-override": "0%",
    });
  });

  const fontsBuilt = (["estedad", "vazirmatn"] as const).every((k) => fs.existsSync(path.join(PKG, OUTPUTS[k])));
  it.skipIf(!fontsBuilt)("served fonts exist and fit the budget (skipped until M0 builds them)", () => {
    for (const key of ["estedad", "vazirmatn"] as const) {
      const abs = path.join(PKG, OUTPUTS[key]);
      expect(fs.existsSync(abs), OUTPUTS[key]).toBe(true);
      expect(fs.statSync(abs).size, OUTPUTS[key]).toBeLessThanOrEqual(BUDGETS[key]);
    }
  });
});

describe("icons", () => {
  // the icon set the web manifest (apps/web/src/app/manifest.ts) publishes
  const manifest = {
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192" },
      { src: "/icons/icon-512.png", sizes: "512x512" },
      { src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" },
      { src: "/icons/mono-512.png", sizes: "512x512", purpose: "monochrome" },
    ],
    shortcuts: [{ name: "فروشگاه", url: "/shop/", icons: [{ src: "/icons/sc-shop.png", sizes: "96x96" }] }],
  };
  const entry = (file: string) => SIZES.find((s) => s.file === file);

  it("SIZES match the manifest icons (192, 512, maskable 512, mono 512) + apple-touch 180 + sc-shop 96 + favicon 48", () => {
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512", "512x512", "512x512"]);
    for (const icon of manifest.icons) {
      const found = entry(icon.src.replace(/^\//u, ""));
      expect(found, icon.src).toBeDefined();
      expect(found?.size, icon.src).toBe(Number(icon.sizes.split("x")[0]));
    }
    expect(entry("icons/maskable-512.png")?.kind).toBe("maskable");
    expect(entry("icons/mono-512.png")?.kind).toBe("mono");
    expect(manifest.icons.find((i) => i.src.endsWith("maskable-512.png"))?.purpose).toBe("maskable");
    expect(manifest.icons.find((i) => i.src.endsWith("mono-512.png"))?.purpose).toBe("monochrome");

    // extras that the manifest does not list as icons
    expect(entry("icons/apple-touch-icon.png")).toMatchObject({ size: 180, kind: "icon", opaque: true });
    expect(entry("icons/sc-shop.png")).toMatchObject({ size: 96, kind: "icon" });
    expect(entry("app:icon.png")).toMatchObject({ size: 48, kind: "icon" });
    expect(SIZES).toHaveLength(manifest.icons.length + 3);

    // the «فروشگاه» shortcut icon
    expect(manifest.shortcuts.flatMap((s) => s.icons ?? [])).toContainEqual({ src: "/icons/sc-shop.png", sizes: "96x96" });
  });

  it("IOS_SPLASH media queries are unique and every entry yields exact W×H = css × dpr", () => {
    const medias = IOS_SPLASH.map((e) => splashMedia(e));
    expect(new Set(medias).size).toBe(IOS_SPLASH.length);
    const files = IOS_SPLASH.map((e) => splashFile(e));
    expect(new Set(files).size).toBe(IOS_SPLASH.length);
    for (const e of IOS_SPLASH) {
      expect(Number.isInteger(e.w * e.r) && Number.isInteger(e.h * e.r), e.name).toBe(true);
      expect(splashFile(e)).toBe(`splash/apple-splash-${e.w * e.r}x${e.h * e.r}.png`);
      expect(splashMedia(e)).toBe(
        `screen and (device-width: ${e.w}px) and (device-height: ${e.h}px) and ` +
          `(-webkit-device-pixel-ratio: ${e.r}) and (orientation: portrait)`,
      );
      expect(e.h, `${e.name} must be portrait`).toBeGreaterThan(e.w);
    }
    // the header's worked example: 393 × 852 @3 → 1179 × 2556
    expect(splashFile({ w: 393, h: 852, r: 3 })).toBe("splash/apple-splash-1179x2556.png");
  });

  it("COLORS use only frame / frame-ink / frame-accent from tokens.json", () => {
    expect(COLORS).toEqual({
      ground: light.frame,
      glyph: light["frame-ink"],
      mark: light["frame-accent"],
    });
    expect(Object.keys(COLORS)).toHaveLength(3);
  });

  // -  -  - rendering (needs the committed fontTools artefact scripts/glyph-noon.json) -  -  - 
  const hasGlyph = fs.existsSync(GLYPH_FILE);
  const tmpDirs: string[] = [];
  let rendered: Promise<string[]> | null = null;

  /** Renders the icon set twice into two fresh temp dirs (memoised across the three tests). */
  function renderTwice(): Promise<string[]> {
    rendered ??= (async () => {
      const dirs: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "namilux-icons-"));
        tmpDirs.push(dir);
        const code = await makeIcons({ out: dir, appDir: path.join(dir, "app"), only: "icons" });
        expect(code).toBe(0);
        dirs.push(dir);
      }
      return dirs;
    })();
    return rendered;
  }

  const raw = async (file: string) => {
    const sharp = (await import("sharp")).default;
    return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const hex = (d: Buffer, i: number) =>
    "#" +
    [d[i], d[i + 1], d[i + 2]]
      .map((v) => Number(v).toString(16).padStart(2, "0").toUpperCase())
      .join("");

  afterAll(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasGlyph)("rendering (skipped without glyph-noon.json): maskable corner 20 % is pure ground", async () => {
    const [dir] = await renderTwice();
    const { data, info } = await raw(path.join(String(dir), "icons", "maskable-512.png"));
    expect(info.width).toBe(512);
    expect(info.height).toBe(512);
    const box = Math.floor(info.width * 0.2);
    const corners: [number, number][] = [
      [0, 0],
      [info.width - box, 0],
      [0, info.height - box],
      [info.width - box, info.height - box],
    ];
    for (const [ox, oy] of corners) {
      for (let y = oy; y < oy + box; y += 1) {
        for (let x = ox; x < ox + box; x += 1) {
          const i = (y * info.width + x) * info.channels;
          expect(hex(data, i), `${x},${y}`).toBe(COLORS.ground);
          expect(data[i + 3], `${x},${y} alpha`).toBe(255);
        }
      }
    }
  });

  it.skipIf(!hasGlyph)("rendering (skipped without glyph-noon.json): mono icon has alpha-0 ground and a single opaque colour", async () => {
    const [dir] = await renderTwice();
    const { data, info } = await raw(path.join(String(dir), "icons", "mono-512.png"));
    const ch = info.channels;
    const corners = [
      0,
      (info.width - 1) * ch,
      (info.height - 1) * info.width * ch,
      ((info.height - 1) * info.width + info.width - 1) * ch,
    ];
    for (const i of corners) expect(data[i + 3]).toBe(0);
    const opaque = new Set<string>();
    let transparent = 0;
    for (let i = 0; i < data.length; i += ch) {
      const alpha = data[i + ch - 1];
      if (alpha === 0) transparent += 1;
      else if (alpha === 255) opaque.add(hex(data, i));
    }
    expect([...opaque]).toEqual([COLORS.glyph]);
    expect(transparent).toBeGreaterThan(info.width * info.height * 0.5);
  });

  it.skipIf(!hasGlyph)("rendering (skipped without glyph-noon.json): two runs produce identical sha256 for icon-512.png", async () => {
    const [a, b] = await renderTwice();
    const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    expect(sha(path.join(String(a), "icons", "icon-512.png"))).toBe(sha(path.join(String(b), "icons", "icon-512.png")));
    expect(sha(path.join(String(a), "icons", "maskable-512.png"))).toBe(
      sha(path.join(String(b), "icons", "maskable-512.png")),
    );
    expect(sha(path.join(String(a), "app", "icon.png"))).toBe(sha(path.join(String(b), "app", "icon.png")));
  });
});
