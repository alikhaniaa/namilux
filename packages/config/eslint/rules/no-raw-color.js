import {
  classTokens,
  isImportSource,
  isTypePosition,
  literalString,
  pathMatches,
  stripVariants,
} from "./utils.js";

export const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/iu;
export const FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/iu;
export const PALETTE =
  /^(?:bg|text|border(?:-[a-z]{1,2})?|fill|stroke|ring|ring-offset|outline|decoration|divide|accent|caret|shadow|inset-shadow|placeholder|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?$/u;

const DEFAULT_ALLOW = ["packages/tokens/"];

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid colour literals (hex / rgb / hsl / oklch …) and Tailwind default-palette utilities outside packages/tokens.",
    },
    schema: [
      {
        type: "object",
        properties: {
          tailwindPalette: { type: "boolean" },
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hex: 'Raw colour "{{match}}" — colours live only in packages/tokens (use a token utility or import tokens.json).',
      fn: 'Raw colour function "{{match}}" — colours live only in packages/tokens.',
      palette:
        'Tailwind palette utility "{{token}}" — the design system has no default palette; use a token utility (bg-surface, text-ink-2, border-line …).',
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const palette = opts.tailwindPalette !== false;
    const allow = Array.isArray(opts.allow) ? opts.allow : DEFAULT_ALLOW;
    if (pathMatches(context.filename, allow)) return {};

    /** @param {any} node @param {string} text */
    function checkString(node, text) {
      if (!text) return;
      const hex = HEX.exec(text);
      if (hex) {
        context.report({ node, messageId: "hex", data: { match: hex[0] } });
        return;
      }
      const fn = FN.exec(text);
      if (fn) {
        context.report({ node, messageId: "fn", data: { match: fn[0] } });
        return;
      }
      if (!palette) return;
      for (const raw of classTokens(text)) {
        const token = stripVariants(raw);
        if (token && PALETTE.test(token)) {
          context.report({ node, messageId: "palette", data: { token: raw } });
          return;
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
    };
  },
};

export default rule;
