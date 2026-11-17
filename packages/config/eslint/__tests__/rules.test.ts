import { RuleTester } from "eslint";
import type { Rule } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------------------------
// Module loading
//
// DECISION: `packages/config/tsconfig/node.json` sets `allowJs: false`, so a static
// `import … from "../rules/index.js"` in a .ts file fails `pnpm typecheck` with TS7016. The rule
// modules are therefore loaded through a non-literal specifier and typed by hand here. Runtime
// behaviour is identical (same relative resolution, same module instance). Reported upward: the
// fix belongs in the package tsconfig (`allowJs: true` + `checkJs: false`), which this file does
// not own.
// ---------------------------------------------------------------------------------------------

const RULES_MODULE = "../rules/index.js";
const UTILS_MODULE = "../rules/utils.js";
const CONFIG_MODULE = "../index.js";

type NamiluxPlugin = {
  meta: { name: string; version: string };
  rules: Record<string, Rule.RuleModule>;
};

type RulesIndexModule = {
  default: NamiluxPlugin;
  RULE_NAMES: readonly string[];
};

type UtilsModule = {
  classTokens: (str: string) => string[];
  stripVariants: (token: string) => string;
};

type Kind = "web" | "admin" | "node" | "library" | "cli";
type Severity = "off" | "warn" | "error" | 0 | 1 | 2;
type RuleEntry = Severity | readonly unknown[];

type ConfigBlock = {
  files?: readonly string[];
  ignores?: readonly string[];
  plugins?: Record<string, unknown>;
  rules?: Record<string, RuleEntry>;
  languageOptions?: Record<string, unknown>;
};

type ConfigModule = {
  configs: Readonly<Record<Kind, readonly ConfigBlock[]>>;
  namiluxConfig: (kind: Kind, extra?: readonly ConfigBlock[]) => ConfigBlock[];
  namiluxPlugin: NamiluxPlugin;
  BANNED_PACKAGES: readonly string[];
  BANNED_PATTERNS: readonly string[];
  UI_KIT_PACKAGES: readonly string[];
  UI_KIT_PATTERNS: readonly string[];
  TS_FILES: readonly string[];
  JS_FILES: readonly string[];
  TSX_FILES: readonly string[];
  IGNORES: readonly string[];
};

const rulesIndex = (await import(RULES_MODULE)) as RulesIndexModule;
const utils = (await import(UTILS_MODULE)) as UtilsModule;
const eslintConfig = (await import(CONFIG_MODULE)) as ConfigModule;

const plugin = rulesIndex.default;
const { RULE_NAMES } = rulesIndex;
const { classTokens, stripVariants } = utils;

/** `plugin.rules[name]` is `| undefined` under `noUncheckedIndexedAccess`. */
function ruleOf(name: string): Rule.RuleModule {
  const rule = plugin.rules[name];
  if (!rule) throw new Error(`namilux/${name} is not registered on the plugin`);
  return rule;
}

// ---------------------------------------------------------------------------------------------
// RuleTester wiring
//
// DECISION: `RuleTester.describe/it` are wired to inline runners instead of vitest's own
// `describe`/`it`, because the spec header fixes one `it` name per EDGE CASE bullet and calling
// vitest's `describe` from inside a running `it` is illegal. Assertions therefore throw inside
// the vitest `it` that owns them, so a rule regression still surfaces as a normal vitest failure
// under the spec's test name. ESLint 9.39.5's RuleTester has no `afterAll` hook (only
// describe/it/itOnly), so there is nothing else to inject.
// ---------------------------------------------------------------------------------------------

const inline = (_name: string, method: () => void): void => {
  method();
};
RuleTester.describe = inline;
RuleTester.it = inline;
RuleTester.itOnly = inline;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const TSX = "Foo.tsx";
const TS = "Foo.ts";

describe("utils", () => {
  it("stripVariants table: md:hover:!-ml-2 → ml-2, [&>*]:pe-3 → pe-3, content-['a:b'] unchanged, '!' → '', '-' → ''", () => {
    const table: readonly [string, string][] = [
      ["ms-2", "ms-2"],
      ["md:hover:!-ml-2", "ml-2"],
      ["[&>*]:pe-3", "pe-3"],
      ["[&:hover]:ml-2", "ml-2"],
      ["content-['a:b']", "content-['a:b']"],
      ["!", ""],
      ["-", ""],
      ["!-mr-1", "mr-1"],
      ["md:rounded-full", "rounded-full"],
      ["", ""],
    ];
    for (const [input, expected] of table) {
      expect(stripVariants(input), input).toBe(expected);
    }
  });

  it("classTokens splits on any whitespace and drops empties", () => {
    expect(classTokens("ms-2  pe-4")).toEqual(["ms-2", "pe-4"]);
    expect(classTokens("ms-2\n\tpe-4  ps-1")).toEqual(["ms-2", "pe-4", "ps-1"]);
    expect(classTokens(" a ")).toEqual(["a"]);
    expect(classTokens("   ")).toEqual([]);
    expect(classTokens("")).toEqual([]);
  });
});

describe("no-physical-direction", () => {
  const rule = ruleOf("no-physical-direction");

  it("valid table: ms-2 me-4 ps-1 pe-3 start-0 end-0 text-start text-end float-start border-s mx-2 px-2 inset-x-0 space-x-2 divide-x html-body xml-parser", () => {
    ruleTester.run("no-physical-direction", rule, {
      valid: [
        {
          filename: TS,
          code: 'const c = "ms-2 me-4 ps-1 pe-3 start-0 end-0 text-start text-end float-start border-s mx-2 px-2 inset-x-0 space-x-2 divide-x html-body xml-parser";',
        },
        { filename: TS, code: 'const c = cn("ms-2", cond && "pe-4");' },
        { filename: TS, code: 'const c = "border-s border-e text-start float-end";' },
      ],
      invalid: [],
    });
  });

  it("invalid table: ml-2 mr-2 pl-2 pr-2 left-0 right-0 text-left text-right float-right border-l rounded-tl-sm scroll-pl-4 md:ml-2 -ml-2 !mr-1 origin-top-left", () => {
    const tokens = [
      "ml-2",
      "mr-2",
      "pl-2",
      "pr-2",
      "left-0",
      "right-0",
      "text-left",
      "text-right",
      "float-right",
      "border-l",
      "rounded-tl-sm",
      "scroll-pl-4",
      "md:ml-2",
      "-ml-2",
      "!mr-1",
      "origin-top-left",
    ];
    ruleTester.run("no-physical-direction", rule, {
      valid: [],
      invalid: tokens.map((token) => ({
        filename: TS,
        code: `const c = ${JSON.stringify(token)};`,
        errors: [{ messageId: "physicalClass", data: { token } }],
      })),
    });
  });

  it("template literal `ms-2 ${gap} pr-3` reports pr-3 only", () => {
    ruleTester.run("no-physical-direction", rule, {
      valid: [{ filename: TS, code: "const c = `ms-2 ${gap} pe-3`;" }],
      invalid: [
        {
          filename: TS,
          code: "const c = `ms-2 ${gap} pr-3`;",
          errors: [{ messageId: "physicalClass", data: { token: "pr-3" } }],
        },
      ],
    });
  });

  it("style objects: style={{ marginLeft: 4 }} reported; { marginInlineStart: 4 } not; geometry object { left: 0 } not", () => {
    ruleTester.run("no-physical-direction", rule, {
      valid: [
        { filename: TSX, code: "const a = <p style={{ marginInlineStart: 4 }} />;" },
        { filename: TSX, code: "const geo = { left: 0, top: 0 };" },
      ],
      invalid: [
        {
          filename: TSX,
          code: "const a = <p style={{ marginLeft: 4 }} />;",
          errors: [{ messageId: "physicalStyleProp", data: { prop: "marginLeft" } }],
        },
        {
          filename: TSX,
          code: "const a = <p style={{ paddingRight: 4 }} />;",
          errors: [{ messageId: "physicalStyleProp", data: { prop: "paddingRight" } }],
        },
      ],
    });
  });

  it("style values: textAlign 'left' reported; float 'right' reported; textAlign 'start' not", () => {
    // DECISION: a physical *value* is reported twice - once as `physicalStyleValue` (the Property
    // visitor) and once as `physicalClass` (the Literal visitor, because "left"/"right" are also
    // whole class tokens). The header only promises "reported", so the double report is asserted
    // as-is rather than weakened; see the report note.
    ruleTester.run("no-physical-direction", rule, {
      valid: [
        { filename: TSX, code: 'const a = <p style={{ textAlign: "start" }} />;' },
        { filename: TSX, code: 'const a = <p style={{ textAlign: "end" }} />;' },
      ],
      invalid: [
        {
          filename: TSX,
          code: 'const a = <p style={{ textAlign: "left" }} />;',
          errors: [
            { messageId: "physicalStyleValue", data: { prop: "textAlign", value: "left" } },
            { messageId: "physicalClass", data: { token: "left" } },
          ],
        },
        {
          filename: TSX,
          code: 'const a = <p style={{ float: "right" }} />;',
          errors: [
            { messageId: "physicalStyleValue", data: { prop: "float", value: "right" } },
            { messageId: "physicalClass", data: { token: "right" } },
          ],
        },
      ],
    });
  });

  it("el.style.left = '0' reported; el.style.insetInlineStart not", () => {
    ruleTester.run("no-physical-direction", rule, {
      valid: [{ filename: TS, code: 'el.style.insetInlineStart = "0";' }],
      invalid: [
        {
          filename: TS,
          code: 'el.style.left = "0";',
          errors: [{ messageId: "physicalStyleProp", data: { prop: "left" } }],
        },
        {
          filename: TS,
          code: 'el.style.marginRight = "0";',
          errors: [{ messageId: "physicalStyleProp", data: { prop: "marginRight" } }],
        },
      ],
    });
  });

  it('type position `type Side = "left" | "right"` not reported', () => {
    ruleTester.run("no-physical-direction", rule, {
      valid: [
        { filename: TS, code: 'type Side = "left" | "right";' },
        { filename: TS, code: 'interface P { side: "left" | "right" }' },
      ],
      invalid: [],
    });
  });

  it("import source 'left-pad' not reported", () => {
    ruleTester.run("no-physical-direction", rule, {
      valid: [
        { filename: TS, code: 'import x from "left-pad";' },
        { filename: TS, code: 'export * from "right-pad";' },
        { filename: TS, code: 'const y = require("left-pad");' },
      ],
      invalid: [],
    });
  });
});

describe("no-raw-color", () => {
  const rule = ruleOf("no-raw-color");

  it("hex table: #F5F6F4 #fff #15181A80 bg-[#111] reported; #reviews #add-address #Intent;scheme #12345 not", () => {
    const hexes: readonly [string, string][] = [
      ["#F5F6F4", "#F5F6F4"],
      ["#fff", "#fff"],
      ["#15181A80", "#15181A80"],
      ["bg-[#111]", "#111"],
    ];
    ruleTester.run("no-raw-color", rule, {
      valid: [
        { filename: TS, code: 'const c = "/product/x/#reviews";' },
        { filename: TS, code: 'const c = "#add-address";' },
        { filename: TS, code: 'const c = "#Intent;scheme=https";' },
        { filename: TS, code: 'const c = "#12345";' },
      ],
      invalid: hexes.map(([text, match]) => ({
        filename: TS,
        code: `const c = ${JSON.stringify(text)};`,
        errors: [{ messageId: "hex", data: { match } }],
      })),
    });
  });

  it("fn table: rgb( rgba( hsl( oklch( color-mix( reported; 'rgbx(' not", () => {
    const fns: readonly [string, string][] = [
      ["rgb(21 24 26 / .14)", "rgb("],
      ["rgba(0,0,0,.5)", "rgba("],
      ["hsl(0 0% 0%)", "hsl("],
      ["oklch(70% 0.1 200)", "oklch("],
      ["color-mix(in oklab, a, b)", "color-mix("],
    ];
    ruleTester.run("no-raw-color", rule, {
      valid: [
        { filename: TS, code: 'const c = "rgbx(1)";' },
        { filename: TS, code: 'const c = "var(--ink-2)";' },
      ],
      invalid: fns.map(([text, match]) => ({
        filename: TS,
        code: `const c = ${JSON.stringify(text)};`,
        errors: [{ messageId: "fn", data: { match } }],
      })),
    });
  });

  it("palette option: bg-white text-gray-500 dark:border-red-500/50 reported when on, not when off; bg-surface text-ink-2 never", () => {
    const paletteTokens = ["bg-white", "text-gray-500", "dark:border-red-500/50"];
    ruleTester.run("no-raw-color", rule, {
      valid: [
        // option off (apps/admin, the spec) - palette passes, hex/fn stay on
        ...paletteTokens.map((token) => ({
          filename: TS,
          code: `const c = ${JSON.stringify(token)};`,
          options: [{ tailwindPalette: false }],
        })),
        // token utilities are never palette utilities, with or without the option
        { filename: TS, code: 'const c = "bg-surface text-ink-2 border-line-input";' },
        {
          filename: TS,
          code: 'const c = "bg-surface text-ink-2 border-line-input";',
          options: [{ tailwindPalette: false }],
        },
      ],
      invalid: [
        ...paletteTokens.map((token) => ({
          filename: TS,
          code: `const c = ${JSON.stringify(token)};`,
          errors: [{ messageId: "palette", data: { token } }],
        })),
        {
          filename: TS,
          code: 'const c = "#15181A";',
          options: [{ tailwindPalette: false }],
          errors: [{ messageId: "hex", data: { match: "#15181A" } }],
        },
      ],
    });
  });

  it("allow paths: file under packages/tokens/ is skipped entirely", () => {
    ruleTester.run("no-raw-color", rule, {
      valid: [
        {
          filename: "packages/tokens/scripts/make-icons.mjs",
          code: 'const c = "#15181A";\nconst d = "rgb(21 24 26 / .14)";\nconst e = "bg-white";',
        },
        {
          // normPath(): a Windows path hits the same allow fragment
          filename: "packages\\tokens\\scripts\\make-icons.mjs",
          code: 'const c = "#15181A";',
        },
        {
          filename: "apps/web/src/brand.ts",
          code: 'const c = "#15181A";',
          options: [{ allow: ["apps/web/src/brand.ts"] }],
        },
      ],
      invalid: [
        {
          filename: "packages/core/src/theme.ts",
          code: 'const c = "#15181A";',
          errors: [{ messageId: "hex", data: { match: "#15181A" } }],
        },
      ],
    });
  });

  it("import source '#internal/x' not reported", () => {
    ruleTester.run("no-raw-color", rule, {
      valid: [
        { filename: TS, code: 'import "#internal/x";' },
        { filename: TS, code: 'import a from "#fff/x";' },
        { filename: TS, code: 'type Hex = "#fff";' },
      ],
      invalid: [],
    });
  });
});

describe("no-dangerous-html", () => {
  const rule = ruleOf("no-dangerous-html");

  it("jsx: <div dangerouslySetInnerHTML={{__html:x}}/> reported in Foo.tsx", () => {
    ruleTester.run("no-dangerous-html", rule, {
      valid: [{ filename: TSX, code: "const a = <div>{text}</div>;" }],
      invalid: [
        {
          filename: TSX,
          code: "const a = <div dangerouslySetInnerHTML={{ __html: x }} />;",
          errors: [{ messageId: "dangerous" }],
        },
      ],
    });
  });

  it("createElement props object and shorthand property reported", () => {
    ruleTester.run("no-dangerous-html", rule, {
      valid: [{ filename: TS, code: 'createElement("div", { className: "plate" }, text);' }],
      invalid: [
        {
          filename: TS,
          code: 'createElement("div", { dangerouslySetInnerHTML: { __html: x } });',
          errors: [{ messageId: "dangerous" }],
        },
        {
          filename: TS,
          code: "const p = { ...props, dangerouslySetInnerHTML };",
          errors: [{ messageId: "dangerous" }],
        },
      ],
    });
  });

  it("sinks: el.innerHTML = '' , el.outerHTML = s, el.insertAdjacentHTML(...), document.write(s) reported; const h = el.innerHTML not", () => {
    ruleTester.run("no-dangerous-html", rule, {
      valid: [
        { filename: TS, code: "const h = el.innerHTML;" },
        { filename: TS, code: "el.replaceChildren();" },
        { filename: TS, code: "el.textContent = s;" },
      ],
      invalid: [
        {
          filename: TS,
          code: 'el.innerHTML = "";',
          errors: [{ messageId: "sink", data: { name: "innerHTML" } }],
        },
        {
          filename: TS,
          code: "el.outerHTML = s;",
          errors: [{ messageId: "sink", data: { name: "outerHTML" } }],
        },
        {
          filename: TS,
          code: 'el.insertAdjacentHTML("beforeend", s);',
          errors: [{ messageId: "sink", data: { name: "insertAdjacentHTML" } }],
        },
        {
          filename: TS,
          code: "document.write(s);",
          errors: [{ messageId: "sink", data: { name: "document.write" } }],
        },
        {
          filename: TS,
          code: "document.writeln(s);",
          errors: [{ messageId: "sink", data: { name: "document.writeln" } }],
        },
      ],
    });
  });

  it("allow list: RichHtml.tsx and JsonLd.tsx basenames and exact repo paths pass; RichHtmlX.tsx does not", () => {
    const sink = "const a = <div dangerouslySetInnerHTML={{ __html: x }} />;";
    ruleTester.run("no-dangerous-html", rule, {
      valid: [
        { filename: "RichHtml.tsx", code: sink },
        { filename: "JsonLd.tsx", code: sink },
        { filename: "apps/web/src/components/content/RichHtml.tsx", code: sink },
        { filename: "apps/web/src/components/seo/JsonLd.tsx", code: sink },
        { filename: "apps\\web\\src\\components\\content\\RichHtml.tsx", code: sink },
        {
          filename: "apps/admin/src/components/content/RichHtml.tsx",
          code: 'el.innerHTML = "";',
          options: [{ allow: ["apps/admin/src/components/content/RichHtml.tsx"] }],
        },
      ],
      invalid: [
        {
          filename: "apps/web/src/components/content/RichHtmlX.tsx",
          code: sink,
          errors: [{ messageId: "dangerous" }],
        },
        {
          // an exact-path allow list does not exempt a same-named file elsewhere
          filename: "apps/web/src/components/content/RichHtml.tsx",
          code: sink,
          options: [{ allow: ["apps/admin/src/components/content/RichHtml.tsx"] }],
          errors: [{ messageId: "dangerous" }],
        },
      ],
    });
  });

  it("plain string 'dangerouslySetInnerHTML' not reported", () => {
    ruleTester.run("no-dangerous-html", rule, {
      valid: [
        { filename: TS, code: 'const s = "dangerouslySetInnerHTML";' },
        { filename: TS, code: 'const s = ["innerHTML", "outerHTML"].join(",");' },
      ],
      invalid: [],
    });
  });
});

describe("no-server-actions", () => {
  const rule = ruleOf("no-server-actions");

  it("module directive 'use server' reported (double and single quotes)", () => {
    ruleTester.run("no-server-actions", rule, {
      valid: [],
      invalid: [
        {
          filename: TS,
          code: '"use server";\nexport async function save() {}',
          errors: [{ messageId: "useServer" }],
        },
        {
          filename: TS,
          code: "'use server';\nexport async function save() {}",
          errors: [{ messageId: "useServer" }],
        },
      ],
    });
  });

  it("function directive inside async function / arrow reported", () => {
    ruleTester.run("no-server-actions", rule, {
      valid: [],
      invalid: [
        {
          filename: TS,
          code: 'async function save() { "use server"; }',
          errors: [{ messageId: "useServer" }],
        },
        {
          filename: TS,
          code: "const f = async () => { 'use server'; };",
          errors: [{ messageId: "useServer" }],
        },
      ],
    });
  });

  it("'use client' and 'use cache' pass; const s = 'use server' passes; comment passes", () => {
    ruleTester.run("no-server-actions", rule, {
      valid: [
        { filename: TS, code: '"use client";\nexport const x = 1;' },
        { filename: TS, code: '"use cache";\nexport const x = 1;' },
        { filename: TS, code: 'const s = "use server";' },
        { filename: TS, code: '// "use server"\nconst x = 1;' },
        { filename: TS, code: 'fetch("/api/orders", { method: "POST" });' },
      ],
      invalid: [],
    });
  });
});

describe("no-locale-number", () => {
  const rule = ruleOf("no-locale-number");

  it("methods: toLocaleString toLocaleDateString toLocaleTimeString toFixed toPrecision reported; toFixedSomething not; optional call n?.toFixed(1) reported", () => {
    const methods: readonly [string, string][] = [
      ['price.toLocaleString("fa-IR");', "toLocaleString"],
      ["new Date().toLocaleDateString();", "toLocaleDateString"],
      ["d.toLocaleTimeString();", "toLocaleTimeString"],
      ["n.toFixed(2);", "toFixed"],
      ["n.toPrecision(3);", "toPrecision"],
      ["n?.toFixed(1);", "toFixed"],
    ];
    ruleTester.run("no-locale-number", rule, {
      valid: [
        { filename: TS, code: "obj.toFixedSomething();" },
        { filename: TS, code: "formatToman(price);" },
        { filename: TS, code: "faInt(1234567);" },
      ],
      invalid: methods.map(([code, name]) => ({
        filename: TS,
        code,
        errors: [{ messageId: "method", data: { name } }],
      })),
    });
  });

  it("Intl: new Intl.NumberFormat, Intl.DateTimeFormat(), new Intl.RelativeTimeFormat reported; Intl.Segmenter / Intl.Collator not", () => {
    const intls: readonly [string, string][] = [
      ['new Intl.NumberFormat("fa-IR");', "NumberFormat"],
      ['Intl.DateTimeFormat("fa-IR");', "DateTimeFormat"],
      ['new Intl.RelativeTimeFormat("fa");', "RelativeTimeFormat"],
    ];
    ruleTester.run("no-locale-number", rule, {
      valid: [
        { filename: TS, code: 'new Intl.Segmenter("fa");' },
        { filename: TS, code: 'new Intl.Collator("fa");' },
      ],
      invalid: intls.map(([code, name]) => ({
        filename: TS,
        code,
        errors: [{ messageId: "intl", data: { name } }],
      })),
    });
  });

  it("allow path: packages/core/src/persian/format.ts skipped", () => {
    ruleTester.run("no-locale-number", rule, {
      valid: [
        {
          filename: "packages/core/src/persian/format.ts",
          code: 'n.toFixed(2);\nnew Intl.NumberFormat("fa-IR");',
        },
        {
          filename: "packages\\core\\src\\persian\\format.ts",
          code: "n.toFixed(2);",
        },
      ],
      invalid: [
        {
          filename: "apps/web/src/components/Price.tsx",
          code: "n.toFixed(2);",
          errors: [{ messageId: "method", data: { name: "toFixed" } }],
        },
      ],
    });
  });
});

describe("no-shape-override", () => {
  const rule = ruleOf("no-shape-override");

  it("radius table: rounded rounded-md rounded-t-lg rounded-[4px] md:rounded-lg reported; rounded-none rounded-full md:rounded-full surrounded-by not", () => {
    const tokens = ["rounded", "rounded-md", "rounded-t-lg", "rounded-[4px]", "md:rounded-lg"];
    ruleTester.run("no-shape-override", rule, {
      valid: [
        {
          filename: TS,
          code: 'const c = "rounded-none rounded-full md:rounded-full surrounded-by";',
        },
      ],
      invalid: tokens.map((token) => ({
        filename: TS,
        code: `const c = ${JSON.stringify(token)};`,
        errors: [{ messageId: "radius", data: { token } }],
      })),
    });
  });

  it("shadow table: shadow shadow-md shadow-[0_1px_0_#000] inset-shadow-sm reported; shadow-none shadow-sheet shadow-pop not", () => {
    const tokens = ["shadow", "shadow-md", "shadow-[0_1px_0_#000]", "inset-shadow-sm"];
    ruleTester.run("no-shape-override", rule, {
      valid: [
        { filename: TS, code: 'const c = "shadow-none shadow-sheet shadow-pop";' },
        { filename: TS, code: 'const c = "md:shadow-pop";' },
      ],
      invalid: tokens.map((token) => ({
        filename: TS,
        code: `const c = ${JSON.stringify(token)};`,
        errors: [{ messageId: "shadow", data: { token } }],
      })),
    });
  });

  it("style keys: borderRadius / borderTopLeftRadius / boxShadow in style={{}} reported; in a non-style object not", () => {
    ruleTester.run("no-shape-override", rule, {
      valid: [
        { filename: TSX, code: 'const o = { borderRadius: 4, boxShadow: "x" };' },
        { filename: TSX, code: "const a = <p style={{ marginInlineStart: 4 }} />;" },
      ],
      invalid: [
        {
          filename: TSX,
          code: "const a = <p style={{ borderRadius: 4 }} />;",
          errors: [{ messageId: "styleProp", data: { prop: "borderRadius" } }],
        },
        {
          filename: TSX,
          code: "const a = <p style={{ borderTopLeftRadius: 4 }} />;",
          errors: [{ messageId: "styleProp", data: { prop: "borderTopLeftRadius" } }],
        },
        {
          filename: TSX,
          code: 'const a = <p style={{ boxShadow: "var(--shadow-pop)" }} />;',
          errors: [{ messageId: "styleProp", data: { prop: "boxShadow" } }],
        },
      ],
    });
  });
});

describe("config", () => {
  const {
    configs,
    namiluxConfig,
    namiluxPlugin,
    BANNED_PACKAGES,
    BANNED_PATTERNS,
    UI_KIT_PACKAGES,
    UI_KIT_PATTERNS,
    TS_FILES,
    JS_FILES,
    TSX_FILES,
  } = eslintConfig;

  const KINDS: readonly Kind[] = ["web", "admin", "node", "library", "cli"];

  const sameFiles = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
    a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);

  /** The two blocks that register the `namilux` plugin: the TS block and the JS block. */
  function namiluxBlock(kind: Kind, files: readonly string[]): ConfigBlock {
    const block = configs[kind].find(
      (b) => b.plugins !== undefined && "namilux" in b.plugins && sameFiles(b.files, files),
    );
    if (!block) throw new Error(`no namilux block for kind ${kind} / files ${files.join(",")}`);
    return block;
  }

  const severityOf = (entry: RuleEntry | undefined): unknown =>
    Array.isArray(entry) ? entry[0] : entry;
  const optionsOf = (entry: RuleEntry | undefined): readonly unknown[] =>
    Array.isArray(entry) ? entry.slice(1) : [];

  type RestrictedImports = {
    paths?: { name: string; message?: string }[];
    patterns?: { group: string[]; message?: string }[];
  };
  function restrictedImportsOf(kind: Kind): RestrictedImports {
    const entry = namiluxBlock(kind, TS_FILES).rules?.["no-restricted-imports"];
    expect(Array.isArray(entry), `${kind}: no-restricted-imports must carry options`).toBe(true);
    return optionsOf(entry)[0] as RestrictedImports;
  }

  it("plugin registers every rule in RULE_NAMES and each rule module has meta.docs.description", () => {
    expect(RULE_NAMES).toEqual([
      "no-physical-direction",
      "no-raw-color",
      "no-dangerous-html",
      "no-server-actions",
      "no-locale-number",
      "no-shape-override",
    ]);
    expect(Object.keys(plugin.rules)).toEqual([...RULE_NAMES]);
    expect(plugin.meta.name).toBe("eslint-plugin-namilux");
    expect(Object.keys(namiluxPlugin.rules)).toEqual([...RULE_NAMES]);

    for (const name of RULE_NAMES) {
      const rule = ruleOf(name);
      expect(rule.meta?.type, name).toBe("problem");
      expect(typeof rule.meta?.docs?.description, name).toBe("string");
      expect((rule.meta?.docs?.description ?? "").length, name).toBeGreaterThan(20);
      expect(Object.keys(rule.meta?.messages ?? {}).length, name).toBeGreaterThan(0);
      expect(typeof rule.create, name).toBe("function");
    }
  });

  it("every kind (web admin node library cli) enables all six namilux rules on TS and JS blocks (admin: no-shape-override off, palette false)", () => {
    for (const kind of KINDS) {
      for (const [label, files] of [
        ["ts", TS_FILES],
        ["js", JS_FILES],
      ] as const) {
        const block = namiluxBlock(kind, files);
        for (const name of RULE_NAMES) {
          const entry = block.rules?.[`namilux/${name}`];
          const where = `${kind}/${label}/${name}`;
          expect(entry, where).toBeDefined();
          const expected = kind === "admin" && name === "no-shape-override" ? "off" : "error";
          expect(severityOf(entry), where).toBe(expected);
        }
        expect(optionsOf(block.rules?.["namilux/no-raw-color"]), `${kind}/${label}`).toEqual([
          { tailwindPalette: kind !== "admin" },
        ]);
      }
    }
  });

  it("web bans UI kit imports; admin does not; every kind bans the spec packages", () => {
    // the spec "Not allowed" - the list the config must cover.
    const stackNotAllowed = [
      "next-auth",
      "prisma",
      "@prisma/client",
      "ioredis",
      "bullmq",
      "axios",
      "moment",
      "dayjs",
      "lodash",
      "lodash-es",
      "express",
      "fastify",
    ];
    for (const name of stackNotAllowed) expect(BANNED_PACKAGES).toContain(name);
    for (const group of ["jalali-*", "@auth/*"]) expect(BANNED_PATTERNS).toContain(group);

    for (const kind of KINDS) {
      const { paths = [], patterns = [] } = restrictedImportsOf(kind);
      const names = paths.map((p) => p.name);
      const groups = patterns.flatMap((p) => p.group);
      for (const banned of BANNED_PACKAGES) expect(names, `${kind}: ${banned}`).toContain(banned);
      for (const banned of BANNED_PATTERNS) expect(groups, `${kind}: ${banned}`).toContain(banned);

      const uiKitBanned = kind === "web";
      for (const kit of UI_KIT_PACKAGES) {
        expect(names.includes(kit), `${kind}: ${kit}`).toBe(uiKitBanned);
      }
      for (const kit of UI_KIT_PATTERNS) {
        expect(groups.includes(kit), `${kind}: ${kit}`).toBe(uiKitBanned);
      }
    }
    // shadcn/Radix are admin-only: admin must not ban them.
    const adminNames = restrictedImportsOf("admin").paths?.map((p) => p.name) ?? [];
    expect(adminNames).not.toContain("lucide-react");
  });

  it("cli kind allows console; others error", () => {
    for (const kind of KINDS) {
      for (const files of [TS_FILES, JS_FILES]) {
        const entry = namiluxBlock(kind, files).rules?.["no-console"];
        if (kind === "cli") expect(entry, kind).toBe("off");
        // DECISION: the spec allows no console exception outside CLIs. ESLint 9 rejects the
        // literal `{ allow: [] }` option ("should NOT have fewer than 1 items"), so the empty
        // allow-list is expressed as the bare "error" severity - identical behaviour.
        else expect(entry, kind).toBe("error");
      }
    }
  });

  it("react-hooks block present for web/admin/library, absent for node/cli", () => {
    for (const kind of KINDS) {
      const block = configs[kind].find(
        (b) => b.plugins !== undefined && "react-hooks" in b.plugins,
      );
      const expected = kind === "web" || kind === "admin" || kind === "library";
      expect(block !== undefined, kind).toBe(expected);
      if (block) {
        expect(sameFiles(block.files, TSX_FILES), kind).toBe(true);
        expect(block.rules?.["react-hooks/rules-of-hooks"], kind).toBe("error");
        expect(block.rules?.["react-hooks/exhaustive-deps"], kind).toBe("warn");
      }
    }
    // namiluxConfig(kind, extra) appends the caller's blocks last (packages/tokens scripts).
    const extra: ConfigBlock = { files: ["scripts/**"], rules: { "no-console": "off" } };
    const withExtra = namiluxConfig("library", [extra]);
    expect(withExtra.at(-1)).toBe(extra);
  });
});
