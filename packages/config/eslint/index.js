import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import plugin from "./rules/index.js";

export const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
export const JS_FILES = ["**/*.js", "**/*.mjs", "**/*.cjs"];
export const TSX_FILES = ["**/*.tsx"];

export const IGNORES = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/out/**",
  "**/coverage/**",
  "**/playwright-report/**",
  "**/test-results/**",
  "**/_legacy/**",
  "**/.media/**",
  "**/public/sw.js",
  "**/public/sw-kill.js",
  "**/next-env.d.ts",
];

/** the spec "Not allowed" + the spec never-list. */
export const BANNED_PACKAGES = Object.freeze([
  "moment",
  "dayjs",
  "lodash",
  "lodash-es",
  "axios",
  "next-auth",
  "ioredis",
  "bullmq",
  "prisma",
  "@prisma/client",
  "express",
  "fastify",
]);
export const BANNED_PATTERNS = Object.freeze(["jalali-*", "@auth/*", "lodash/*", "moment-*"]);

/** the spec: shadcn/Radix and friends are admin-only; the storefront is bespoke. */
export const UI_KIT_PACKAGES = Object.freeze([
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "lucide-react",
  "daisyui",
]);
export const UI_KIT_PATTERNS = Object.freeze(["@radix-ui/*", "@mui/*", "@headlessui/*", "shadcn*"]);

const BANNED_MESSAGE =
  "Not in the dependency allow-list. Dates: Intl via @namilux/core persian. HTTP: fetch. Auth/queues/ORM: the bespoke core.";
const UI_KIT_MESSAGE =
  "No UI kit in apps/web. The storefront components are bespoke; recipes live in apps/web/src/styles/components.css.";

/** @param {"web"|"admin"|"node"|"library"|"cli"} kind */
function restrictedImports(kind) {
  const paths = BANNED_PACKAGES.map((name) => ({ name, message: BANNED_MESSAGE }));
  const patterns = BANNED_PATTERNS.map((group) => ({ group: [group], message: BANNED_MESSAGE }));
  if (kind === "web") {
    for (const name of UI_KIT_PACKAGES) paths.push({ name, message: UI_KIT_MESSAGE });
    for (const group of UI_KIT_PATTERNS) patterns.push({ group: [group], message: UI_KIT_MESSAGE });
  }
  return ["error", { paths, patterns }];
}

/** @param {"web"|"admin"|"node"|"library"|"cli"} kind */
function customRules(kind) {
  const admin = kind === "admin";
  return {
    "namilux/no-physical-direction": "error",
    "namilux/no-raw-color": ["error", { tailwindPalette: !admin }],
    "namilux/no-dangerous-html": "error",
    "namilux/no-server-actions": "error",
    "namilux/no-locale-number": "error",
    "namilux/no-shape-override": admin ? "off" : "error",
  };
}

const COMMON_RULES = {
  "no-restricted-properties": [
    "error",
    {
      object: "Math",
      property: "random",
      message: "Not for ids/tokens/codes — use crypto.randomBytes / crypto.getRandomValues.",
    },
    { object: "document", property: "write", message: "HTML sink." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "TSEnumDeclaration",
      message: "Use a string-literal union with `as const` (erasable syntax only; the spec uses unions).",
    },
    // DECISION (M0): TSParameterProperty is NOT restricted. the spec fixes the
    // AppError signature as `constructor(public code: ErrorCode, public httpStatus: number, …)`,
    // and the spec owns the core API, so the rule would forbid the decided contract. The matching
    // tsconfig flag `erasableSyntaxOnly` was removed from the shared preset for the same reason
    // (the spec, 2026-08-25). Enums stay restricted - the spec uses unions.
  ],
  "no-var": "error",
  "prefer-const": "error",
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
};

const TS_RULES = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
};

/** @param {"web"|"admin"|"node"|"library"|"cli"} kind */
function globalsFor(kind) {
  switch (kind) {
    case "web":
    case "admin":
      return { ...globals.browser, ...globals.node, ...globals.serviceworker };
    case "library":
      return { ...globals.node, ...globals.browser };
    case "node":
    case "cli":
    default:
      return { ...globals.node };
  }
}

/**
 * @param {"web"|"admin"|"node"|"library"|"cli"} kind
 * @param {import("eslint").Linter.Config[]} [extra]
 * @returns {import("eslint").Linter.Config[]}
 */
export function namiluxConfig(kind, extra = []) {
  // DECISION: the spec forbids `console.log` in apps with no exceptions. ESLint 9 rejects
  // `{ allow: [] }` ("should NOT have fewer than 1 items"), so the empty allow-list is expressed
  // as the bare "error" option - identical behaviour, valid schema.
  const consoleRule = kind === "cli" ? "off" : "error";
  const typeChecked = tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: TS_FILES }));
  const usesReact = kind === "web" || kind === "admin" || kind === "library";

  /** @type {import("eslint").Linter.Config[]} */
  const config = [
    { ignores: IGNORES },
    { ...js.configs.recommended, files: [...TS_FILES, ...JS_FILES] },
    ...typeChecked,
    {
      files: TS_FILES,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { projectService: true, ecmaFeatures: { jsx: usesReact } },
        globals: globalsFor(kind),
      },
      plugins: { "@typescript-eslint": tseslint.plugin, namilux: plugin },
      rules: {
        ...COMMON_RULES,
        ...TS_RULES,
        ...customRules(kind),
        "no-console": consoleRule,
        "no-restricted-imports": restrictedImports(kind),
      },
    },
    {
      files: JS_FILES,
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
        globals: globalsFor(kind),
      },
      plugins: { namilux: plugin },
      rules: {
        ...COMMON_RULES,
        ...customRules(kind),
        "no-console": consoleRule,
        "no-restricted-imports": restrictedImports(kind),
      },
    },
  ];

  if (usesReact) {
    config.push({
      files: TSX_FILES,
      plugins: { "react-hooks": reactHooks },
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    });
  }

  // Test files may spell forbidden patterns inside fixtures/expectations.
  config.push({
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  });

  return [...config, ...extra];
}

export const configs = Object.freeze({
  web: namiluxConfig("web"),
  admin: namiluxConfig("admin"),
  node: namiluxConfig("node"),
  library: namiluxConfig("library"),
  cli: namiluxConfig("cli"),
});

export { plugin as namiluxPlugin };
export default configs.library;
