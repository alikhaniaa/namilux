import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCustomer } from "@namilux/core";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { ProfileForm } from "@/components/account/ProfileForm";

export default async function AccountProfileRoute(): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const user = await currentUser();
  if (user === null) redirect("/account/login/?next=/account/profile/");
  const customer = await getCustomer(db, user.customerId);
  if (customer === null) redirect("/account/login/");
  return <ProfileForm customer={customer} />;
}
