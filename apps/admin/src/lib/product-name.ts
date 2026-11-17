/**
 * The product form shows ONE name, «نام محصول», bound to `displayName` - what the storefront, cart,
 * invoice and search index print.
 *
 * `products.name` is the legacy name (the WordPress import's title). It stays in the row because the
 * DB's `search_text` indexes it and old searches still find the product by it, and the admin write
 * schema still requires it non-empty. So:
 * - an existing product keeps its stored legacy name untouched, whatever the editor types;
 * - a new product has no legacy name, and gets the typed name as its `name` so the write validates
 *   and the two columns agree from day one;
 * - an existing row whose legacy name is blank (it would fail the schema) is healed the same way.
 */
export function namePatch(isNew: boolean, displayName: string, currentName: string): { displayName: string; name?: string } {
  return isNew || currentName.trim() === "" ? { displayName, name: displayName.trim() } : { displayName };
}

/** The legacy name is worth showing (as a quiet hint) only when it says something the display name does not. */
export function legacyNameDiffers(name: string, displayName: string): boolean {
  const norm = (s: string): string => s.replace(/[\s‌]+/g, " ").trim();
  return norm(name) !== "" && norm(name) !== norm(displayName);
}
