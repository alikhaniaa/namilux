export const tags = {
  catalog: "catalog", settings: "settings", content: "content", sitemap: "sitemap", nav: "nav", home: "home", search: "search-index",
  product: (id: number) => `product:${id}` as const,
  category: (id: number) => `category:${id}` as const,
  brand: (id: number) => `brand:${id}` as const,
  collection: (id: number) => `collection:${id}` as const,
  post: (slug: string) => `post:${slug}` as const,
  page: (slug: string) => `page:${slug}` as const,
  menu: (key: string) => `menu:${key}` as const,
} as const;
export type CacheTag = string;
const TAG_RE = /^(catalog|settings|content|sitemap|nav|home|search-index|(product|category|brand|collection):\d+|(post|page|menu):[^\s/]{1,200})$/u;
export function isCacheTag(s: string): boolean { return TAG_RE.test(s); }
