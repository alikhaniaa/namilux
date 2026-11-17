import { namiluxConfig } from "@namilux/config/eslint";

export default namiluxConfig("node", [
  // The contract checkers and the repo tools ARE their output: a report on stdout is the
  // product, not a stray debug line. the spec bans console "in apps".
  { files: ["contract/**", "tools/**"], rules: { "no-console": "off" } },
  // tools/forbidden-patterns.mjs necessarily spells out the tokens it scans for.
  { files: ["tools/**"], rules: { "namilux/no-shape-override": "off" } },
  {
    files: ["e2e/**", "security/**", "contract/**/__tests__/**"],
    rules: {
      "namilux/no-physical-direction": "off",
      "namilux/no-raw-color": "off",
      "namilux/no-dangerous-html": "off",
      "namilux/no-locale-number": "off",
      "namilux/no-shape-override": "off",
    },
  },
]);
