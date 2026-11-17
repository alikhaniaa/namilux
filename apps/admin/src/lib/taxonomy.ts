import type { TreeNode } from "@/components/forms/TreePicker";

/** «Bosch Home» → «bosch-home»: the brand slug a Latin name suggests (core zLatinSlug). */
export function latinSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Options the server has not re-sent yet (just created) merged in without duplicates. */
export function mergeOptions<T extends { id: number }>(server: T[], local: T[]): T[] {
  const seen = new Set(server.map((o) => o.id));
  return [...server, ...local.filter((o) => !seen.has(o.id))];
}

/** Inserts a just-created category under its parent (or at the root) unless the tree already has it. */
export function insertNode(tree: TreeNode[], node: TreeNode, parentId: number | null): TreeNode[] {
  const has = (nodes: TreeNode[]): boolean => nodes.some((n) => n.id === node.id || has(n.children));
  if (has(tree)) return tree;
  if (parentId === null) return [...tree, node];
  let placed = false;
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) => {
      if (n.id === parentId) {
        placed = true;
        return { ...n, children: [...n.children, node] };
      }
      return n.children.length === 0 ? n : { ...n, children: walk(n.children) };
    });
  const next = walk(tree);
  return placed ? next : [...tree, node];
}
