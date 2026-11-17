/** @param {string} str */
export function classTokens(str) {
  return str.split(/\s+/u).filter((t) => t.length > 0);
}

/** @param {string} token */
export function stripVariants(token) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) cut = i;
  }
  let util = cut >= 0 ? token.slice(cut + 1) : token;
  if (util.startsWith("!")) util = util.slice(1);
  if (util.startsWith("-")) util = util.slice(1);
  return util;
}

/** @param {any} node */
export function isImportSource(node) {
  const p = node.parent;
  if (!p) return false;
  if (
    (p.type === "ImportDeclaration" ||
      p.type === "ExportNamedDeclaration" ||
      p.type === "ExportAllDeclaration" ||
      p.type === "ImportExpression") &&
    p.source === node
  ) {
    return true;
  }
  if (p.type === "TSImportType" || p.type === "TSExternalModuleReference") return true;
  if (
    p.type === "CallExpression" &&
    p.callee &&
    p.callee.type === "Identifier" &&
    p.callee.name === "require" &&
    p.arguments[0] === node
  ) {
    return true;
  }
  return false;
}

/** @param {any} node */
export function isTypePosition(node) {
  let cur = node.parent;
  while (cur) {
    if (typeof cur.type === "string" && cur.type.startsWith("TS")) return true;
    if (
      cur.type === "ExpressionStatement" ||
      cur.type === "VariableDeclaration" ||
      cur.type === "ReturnStatement" ||
      cur.type === "Program" ||
      cur.type === "JSXElement" ||
      cur.type === "BlockStatement"
    ) {
      return false;
    }
    cur = cur.parent;
  }
  return false;
}

/** @param {string} p */
export function normPath(p) {
  return p.replace(/\\/g, "/");
}

/**
 * @param {string} file
 * @param {readonly string[]} fragments
 */
export function pathMatches(file, fragments) {
  const f = normPath(file);
  return fragments.some((frag) => f.includes(normPath(frag)));
}

/** @param {any} node */
export function literalString(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateElement") {
    const v = node.value && (node.value.cooked ?? node.value.raw);
    return typeof v === "string" ? v : null;
  }
  return null;
}
