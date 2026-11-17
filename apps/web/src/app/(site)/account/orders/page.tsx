import { listOrdersForCustomer } from "@namilux/core";
import { AccountEmpty } from "@/components/account/AccountEmpty";
import { redirect } from "next/navigation";
import { OrderList } from "@/components/account/OrderList";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

export default async function AccountOrdersRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactNode> {
  const user = await currentUser();
  if (user === null) redirect("/account/login/?next=/account/orders/");
  const sp = await searchParams;
  const rawPage = typeof sp["page"] === "string" ? Number(sp["page"]) : 1;
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const { items, total } = await listOrdersForCustomer(db, user.customerId, page);
  if (items.length === 0 && page === 1) {
    return (
      <AccountEmpty icon="bag" title="account.emptyOrders.title" body="account.emptyOrders.body" />
    );
  }
  return <OrderList orders={items} page={page} total={total} />;
}
