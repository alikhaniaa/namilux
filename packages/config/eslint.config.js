import { namiluxConfig } from "./eslint/index.js";

export default namiluxConfig("library", [
  {
    files: ["eslint/__tests__/**", "eslint/rules/**"],
    rules: {
      "namilux/no-physical-direction": "off",
      "namilux/no-raw-color": "off",
      "namilux/no-dangerous-html": "off",
      "namilux/no-server-actions": "off",
      "namilux/no-locale-number": "off",
      "namilux/no-shape-override": "off",
    },
  },
]);
