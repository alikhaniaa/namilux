import { redirect } from "next/navigation";
import { connection } from "next/server";
import { addresses } from "@namilux/core";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { AddressList } from "@/components/account/AddressList";

export default async function AccountAddressesRoute(): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const user = await currentUser();
  if (user === null) redirect("/account/login/?next=/account/addresses/");
  const list = await addresses.list(db, user.customerId);
  return <AddressList addresses={list} />;
}
