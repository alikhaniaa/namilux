import { pathMatches } from "./utils.js";

const METHODS = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toFixed",
  "toPrecision",
]);
const INTL = new Set(["NumberFormat", "DateTimeFormat", "RelativeTimeFormat"]);
const DEFAULT_ALLOW = ["packages/core/src/persian/"];

/** @param {any} key */
function propName(key) {
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid toLocaleString/toFixed/Intl formatting outside @namilux/core persian formatters.",
    },
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      method:
        '"{{name}}()" renders Latin digits / Gregorian dates — use faInt, faDigits, formatToman, formatJalali or formatRelative from @namilux/core.',
      intl: '"Intl.{{name}}" is only allowed inside packages/core/src/persian/** — use the exported formatters.',
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const allow = Array.isArray(opts.allow) && opts.allow.length > 0 ? opts.allow : DEFAULT_ALLOW;
    if (pathMatches(context.filename, allow)) return {};

    /** @param {any} node CallExpression | NewExpression */
    function check(node) {
      const callee = node.callee;
      if (!callee || callee.type !== "MemberExpression") return;
      const name = propName(callee.property);
      if (name === null) return;
      const obj = callee.object;
      if (obj && obj.type === "Identifier" && obj.name === "Intl") {
        if (INTL.has(name)) {
          context.report({ node: callee.property, messageId: "intl", data: { name } });
        }
        return;
      }
      if (METHODS.has(name)) {
        context.report({ node: callee.property, messageId: "method", data: { name } });
      }
    }

    return {
      CallExpression: check,
      NewExpression: check,
    };
  },
};

export default rule;
