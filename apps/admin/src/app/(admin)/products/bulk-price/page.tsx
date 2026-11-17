import { redirect } from "next/navigation";

type SP = Record<string, string | string[] | undefined>;

/** The formula editor moved into the pricing section; old links and bookmarks keep their selection. */
export default async function BulkPriceRedirect({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) query.set(key, v);
  }
  const qs = query.toString();
  redirect(qs === "" ? "/products/prices/group" : `/products/prices/group?${qs}`);
}
