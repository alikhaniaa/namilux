import { enDigits } from "@namilux/core/client";

/** Decoded Persian addresses, like the imported catalogue. Only used for new products. */
export function productSlug(name: string, model = ""): string {
  const clean = (text: string): string => enDigits(text).normalize("NFC").replace(/ي/g, "ی").replace(/ك/g, "ک")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const base = clean(name);
  const code = clean(model);
  return (code !== "" && !base.split("-").join("").includes(code.split("-").join("")) ? `${base}-${code}` : base)
    .slice(0, 200).replace(/^-+|-+$/g, "");
}

/** Keep a manually chosen address and every saved address unchanged. */
export function automaticSlug(isNew: boolean, current: string, name: string, model: string, nextName: string, nextModel: string): string {
  return isNew && (current === "" || current === productSlug(name, model)) ? productSlug(nextName, nextModel) : current;
}

export function alternativeSlug(slug: string): string {
  const match = /-(\d{1,6})$/.exec(slug);
  const suffix = `-${match ? Number(match[1]) + 1 : 2}`;
  const base = match ? slug.slice(0, match.index) : slug;
  return `${base.slice(0, 200 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
