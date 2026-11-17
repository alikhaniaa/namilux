import {
  classTokens,
  isImportSource,
  isTypePosition,
  literalString,
  stripVariants,
} from "./utils.js";

export const ALLOWED_RADIUS = new Set(["rounded-none", "rounded-full"]);
export const ALLOWED_SHADOW = new Set(["shadow-none", "shadow-sheet", "shadow-pop"]);
const RADIUS = /^rounded(?:-|$)/u;
const SHADOW = /^(?:inset-)?shadow(?:-|$)/u;
const STYLE_KEY = /(?:Radius$|^boxShadow$)/u;

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid rounded-* (except none/full) and shadow-* (except none/sheet/pop): the system is flat and square.",
    },
    schema: [],
    messages: {
      radius: '"{{token}}" — radius is 0 everywhere; only rounded-none and rounded-full (badges, dots) exist.',
      shadow: '"{{token}}" — no elevation on static content; only shadow-sheet (sheets/drawers) and shadow-pop (popovers/toasts).',
      styleProp: '"{{prop}}" in an inline style — the system has no radius and only the two shadow tokens.',
    },
  },
  create(context) {
    /** @param {any} node @param {string} text */
    function checkString(node, text) {
      if (!text || !/(?:rounded|shadow)/u.test(text)) return;
      for (const raw of classTokens(text)) {
        const token = stripVariants(raw);
        if (RADIUS.test(token) && !ALLOWED_RADIUS.has(token)) {
          context.report({ node, messageId: "radius", data: { token: raw } });
        } else if (SHADOW.test(token) && !ALLOWED_SHADOW.has(token)) {
          context.report({ node, messageId: "shadow", data: { token: raw } });
        }
      }
    }

    return {
      Literal(node) {
        const s = literalString(node);
        if (s === null || isImportSource(node) || isTypePosition(node)) return;
        checkString(node, s);
      },
      TemplateElement(node) {
        const s = literalString(node);
        if (s === null) return;
        const tpl = node.parent;
        if (tpl && (isImportSource(tpl) || isTypePosition(tpl))) return;
        checkString(node, s);
      },
      Property(node) {
        const obj = node.parent;
        if (!obj || obj.type !== "ObjectExpression") return;
        const container = obj.parent;
        const inStyle =
          container &&
          container.type === "JSXExpressionContainer" &&
          container.parent &&
          container.parent.type === "JSXAttribute" &&
          container.parent.name &&
          container.parent.name.name === "style";
        if (!inStyle) return;
        const key = node.key;
        const name =
          key && key.type === "Identifier"
            ? key.name
            : key && key.type === "Literal" && typeof key.value === "string"
              ? key.value
              : null;
        if (name !== null && STYLE_KEY.test(name)) {
          context.report({ node: key, messageId: "styleProp", data: { prop: name } });
        }
      },
    };
  },
};

export default rule;
