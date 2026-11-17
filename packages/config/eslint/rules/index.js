import noDangerousHtml from "./no-dangerous-html.js";
import noLocaleNumber from "./no-locale-number.js";
import noPhysicalDirection from "./no-physical-direction.js";
import noRawColor from "./no-raw-color.js";
import noServerActions from "./no-server-actions.js";
import noShapeOverride from "./no-shape-override.js";

export const RULE_NAMES = Object.freeze([
  "no-physical-direction",
  "no-raw-color",
  "no-dangerous-html",
  "no-server-actions",
  "no-locale-number",
  "no-shape-override",
]);

const plugin = {
  meta: { name: "eslint-plugin-namilux", version: "0.0.0" },
  rules: {
    "no-physical-direction": noPhysicalDirection,
    "no-raw-color": noRawColor,
    "no-dangerous-html": noDangerousHtml,
    "no-server-actions": noServerActions,
    "no-locale-number": noLocaleNumber,
    "no-shape-override": noShapeOverride,
  },
};

export default plugin;
