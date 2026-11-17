import { normPath } from "./utils.js";

const DEFAULT_ALLOW = ["RichHtml.tsx", "JsonLd.tsx"];
const SINK_CALLS = new Set(["insertAdjacentHTML", "write", "writeln"]);
const SINK_ASSIGN = new Set(["innerHTML", "outerHTML"]);

/** @param {string} file @param {readonly string[]} allow */
export function isAllowedFile(file, allow) {
  const f = normPath(file);
  return allow.some((entry) => {
    const e = normPath(entry);
    return f === e || f.endsWith("/" + e);
  });
}

/** @param {any} key */
function keyName(key) {
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
        "Forbid dangerouslySetInnerHTML and DOM HTML sinks outside RichHtml.tsx and JsonLd.tsx.",
    },
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      dangerous:
        "dangerouslySetInnerHTML is allowed only in RichHtml.tsx (sanitized) and JsonLd.tsx — render through <RichHtml html={…} /> instead.",
      sink: '"{{name}}" is an HTML sink — build DOM with createElement/textContent or render through RichHtml.',
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const allow = Array.isArray(opts.allow) && opts.allow.length > 0 ? opts.allow : DEFAULT_ALLOW;
    if (isAllowedFile(context.filename, allow)) return {};

    return {
      JSXAttribute(node) {
        const n = node.name;
        if (n && n.type === "JSXIdentifier" && n.name === "dangerouslySetInnerHTML") {
          context.report({ node, messageId: "dangerous" });
        }
      },
      Property(node) {
        if (keyName(node.key) === "dangerouslySetInnerHTML") {
          context.report({ node: node.key, messageId: "dangerous" });
        }
      },
      AssignmentExpression(node) {
        const left = node.left;
        if (!left || left.type !== "MemberExpression") return;
        const name = keyName(left.property);
        if (name !== null && SINK_ASSIGN.has(name)) {
          context.report({ node: left.property, messageId: "sink", data: { name } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        const name = keyName(callee.property);
        if (name === null || !SINK_CALLS.has(name)) return;
        if (name === "insertAdjacentHTML") {
          context.report({ node: callee.property, messageId: "sink", data: { name } });
          return;
        }
        const obj = callee.object;
        if (obj && obj.type === "Identifier" && obj.name === "document") {
          context.report({
            node: callee.property,
            messageId: "sink",
            data: { name: "document." + name },
          });
        }
      },
    };
  },
};

export default rule;
