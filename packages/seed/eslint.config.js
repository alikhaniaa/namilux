import { namiluxConfig } from "@namilux/config/eslint";

export default namiluxConfig("node", [
  // One-off operator script from the 29 Aug demo deployment (journal covers); not part of the package build.
  { ignores: ["link-covers.mts"] },
  { files: ["src/cli.ts", "src/report.ts", "src/legacy-orders.ts"], rules: { "no-console": "off" } },
  {
    files: ["src/**/__tests__/**"],
    rules: {
      "namilux/no-physical-direction": "off",
      "namilux/no-raw-color": "off",
      "namilux/no-dangerous-html": "off",
      "namilux/no-locale-number": "off",
      "namilux/no-shape-override": "off",
    },
  },
]);
