/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",
  embeddedLanguageFormatting: "auto",
  overrides: [
    { files: ["*.md"], options: { proseWrap: "preserve" } },
    { files: ["*.json", "*.jsonc"], options: { printWidth: 120 } },
    { files: ["*.yml", "*.yaml"], options: { singleQuote: false } },
  ],
};

export default config;
