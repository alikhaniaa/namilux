import { namiluxConfig } from "@namilux/config/eslint";

export default namiluxConfig("node", [
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
