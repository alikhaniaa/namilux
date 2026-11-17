import {
  classTokens,
  isImportSource,
  isTypePosition,
  literalString,
  stripVariants,
} from "./utils.js";

export const PHYSICAL_CLASS =
  /^(?:(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|divide-l|divide-r)(?:-|$)|(?:text|float|clear|object|bg|origin|justify-self)-(?:left|right)$|origin-(?:top|bottom)-(?:left|right)$)/u;

export const PHYSICAL_PROP =
  /^(?:left|right|(?:margin|padding|border|scrollMargin|scrollPadding)(?:Left|Right)\w*|borderTop(?:Left|Right)Radius|borderBottom(?:Left|Right)Radius)$/u;

const VALUE_PROPS = new Set(["textAlign", "float", "clear"]);

/** @param {any} key */
function keyName(key) {
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/** @param {any} obj ObjectExpression */
function isStyleObject(obj) {
  const p = obj.parent;
  if (!p) return false;
  if (p.type === "JSXExpressionContainer") {
    const attr = p.parent;
    return attr && attr.type === "JSXAttribute" && attr.name && attr.name.name === "style";
  }
  if (p.type === "VariableDeclarator" && p.id && p.id.type === "Identifier") {
    return /style/iu.test(p.id.name);
  }
  if (p.type === "Property") {
    const k = keyName(p.key);
    return k !== null && /style/iu.test(k);
  }
  if (p.type === "CallExpression" && p.callee && p.callee.type === "MemberExpression") {
    const prop = p.callee.property;
    return prop && prop.type === "Identifier" && prop.name === "assign";
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid physical-direction Tailwind utilities and CSS properties; the storefront is RTL and uses logical properties only.",
    },
    schema: [],
    messages: {
      physicalClass:
        'Physical-direction utility "{{token}}" — use the logical form (ms-/me-/ps-/pe-, start-/end-, text-start/end, border-s/e).',
      physicalStyleProp:
        'Physical CSS property "{{prop}}" — use the logical property (marginInlineStart, insetInlineEnd, borderInlineStart, …).',
      physicalStyleValue:
        '"{{prop}}: {{value}}" is physical — use "start"/"end" (textAlign) or a logical layout instead of float/clear.',
    },
  },
  create(context) {
    /** @param {any} node @param {string} text */
    function checkString(node, text) {
      if (!text || !/[lr]/u.test(text)) return;
      for (const raw of classTokens(text)) {
        const token = stripVariants(raw);
        if (token && PHYSICAL_CLASS.test(token)) {
          context.report({ node, messageId: "physicalClass", data: { token: raw } });
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
        if (!obj || obj.type !== "ObjectExpression" || !isStyleObject(obj)) return;
        const k = keyName(node.key);
        if (k === null) return;
        if (PHYSICAL_PROP.test(k)) {
          context.report({ node: node.key, messageId: "physicalStyleProp", data: { prop: k } });
          return;
        }
        if (VALUE_PROPS.has(k) && node.value && node.value.type === "Literal") {
          const v = node.value.value;
          if (v === "left" || v === "right") {
            context.report({
              node: node.value,
              messageId: "physicalStyleValue",
              data: { prop: k, value: v },
            });
          }
        }
      },
      AssignmentExpression(node) {
        const left = node.left;
        if (!left || left.type !== "MemberExpression") return;
        const obj = left.object;
        if (!obj || obj.type !== "MemberExpression") return;
        const styleProp = obj.property;
        if (!styleProp || styleProp.type !== "Identifier" || styleProp.name !== "style") return;
        const prop = left.property;
        const name = prop && prop.type === "Identifier" ? prop.name : keyName(prop);
        if (name === null || name === undefined) return;
        if (PHYSICAL_PROP.test(name)) {
          context.report({ node: prop, messageId: "physicalStyleProp", data: { prop: name } });
        } else if (VALUE_PROPS.has(name) && node.right && node.right.type === "Literal") {
          const v = node.right.value;
          if (v === "left" || v === "right") {
            context.report({
              node: node.right,
              messageId: "physicalStyleValue",
              data: { prop: name, value: v },
            });
          }
        }
      },
    };
  },
};

export default rule;
