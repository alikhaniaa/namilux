import type { CategoryTreeNode } from "@namilux/core";

/** The category tree as an indented list; each entry carries its own id and every descendant's. */
export function flatCategories(nodes: CategoryTreeNode[], depth = 0): { id: number; name: string; ids: number[] }[] {
  return nodes.flatMap((n) => {
    const children = flatCategories(n.children, depth + 1);
    return [{ id: n.id, name: `${"· ".repeat(depth)}${n.name}`, ids: [n.id, ...children.map((c) => c.id)] }, ...children];
  });
}
