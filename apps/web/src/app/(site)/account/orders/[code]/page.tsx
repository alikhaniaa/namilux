import { getOrderForCustomer } from "@namilux/core";
import { notFound, redirect } from "next/navigation";
import { OrderDetail } from "@/components/account/OrderDetail";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { connection } from "next/server";

export default async function AccountOrderRoute({ params }: { params: Promise<{ code: string }> }): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const code = decodeURIComponent((await params).code).toUpperCase();
  const user = await currentUser();
  if (user === null) redirect(`/account/login/?next=/account/orders/${encodeURIComponent(code)}/`);
  const order = await getOrderForCustomer(db, code, user.customerId);
  if (order === null) notFound();
  return <OrderDetail order={order} />;
}
