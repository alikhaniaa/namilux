import { backInStock, concierge, getProductCards, productUrl } from "@namilux/core";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { RequestsList } from "@/components/account/RequestsList";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { CHANNEL } from "@/lib/channel";

export default async function AccountRequestsRoute(): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const user = await currentUser();
  if (user === null) redirect("/account/login/?next=/account/requests/");
  const [bis, requests] = await Promise.all([backInStock.listForCustomer(db, user.customerId), concierge.listForCustomer(db, user.customerId, CHANNEL)]);
  const ids = [...new Set(bis.map((r) => r.productId))];
  // No price is read here (only the name and the URL), so this list needs no channel pricing.
  const cards = ids.length === 0 ? [] : await getProductCards(db, ids);
  const products: Record<number, { name: string; href: string }> = {};
  for (const c of cards) products[c.id] = { name: c.displayName, href: productUrl(c.slug) };
  return <RequestsList backInStock={bis} concierge={requests} products={products} />;
}
