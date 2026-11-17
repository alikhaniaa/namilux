import { namiluxConfig } from "@namilux/config/eslint";

export default namiluxConfig("node", [
  { files: ["scripts/**"], rules: { "no-console": "off" } },
  {
    files: ["src/**/__tests__/**"],
    rules: { "namilux/no-locale-number": "off", "namilux/no-raw-color": "off" },
  },
]);
