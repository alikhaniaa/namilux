/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Forbid the "use server" directive — mutations are explicit route handlers under app/api/**.',
    },
    schema: [],
    messages: {
      useServer:
        'Server Actions are forbidden - implement an explicit route handler under app/api/** and call it with fetch("/api/…").',
    },
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        if (node.directive === "use server") {
          context.report({ node, messageId: "useServer" });
          return;
        }
        const e = node.expression;
        if (e && e.type === "Literal" && e.value === "use server") {
          context.report({ node, messageId: "useServer" });
        }
      },
    };
  },
};

export default rule;
