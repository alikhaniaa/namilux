import { namiluxConfig } from "@namilux/config/eslint";

export default namiluxConfig("library", [
  {
    files: ["scripts/**/*.mjs", "contrast-check.mjs"],
    rules: {
      "no-console": "off",
      // DECISION: these two rules guard *UI* output, and these files are build/gate CLIs.
      // - no-shape-override fires on the literal "shadow" inside the gate's own list of token
      //   groups it must check; the gate cannot check shadow tokens without naming them.
      // - no-locale-number fires on `toFixed(2)` in the terminal report; the spec forbids it in
      //   UI copy (numbers there go through faInt/formatToman), not in a developer console table.
      "namilux/no-shape-override": "off",
      "namilux/no-locale-number": "off",
    },
  },
]);
