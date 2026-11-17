import { benefitsFor, getCustomer, loyalty, tierInfo } from "@namilux/core";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ClubPanel } from "@/components/account/ClubPanel";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { loadSettings } from "@/server/loaders/settings";

export default async function AccountClubRoute(): Promise<React.ReactNode> {
  // cacheComponents: this page is personal (cookie session) and has no searchParams - declare the dynamic hole before any data read.
  await connection();
  const user = await currentUser();
  if (user === null) redirect("/account/login/?next=/account/club/");
  const [customer, settings] = await Promise.all([getCustomer(db, user.customerId), loadSettings()]);
  if (customer === null) redirect("/account/login/");
  const rules = settings["loyalty.rules"];
  const [info, history] = await Promise.all([tierInfo(db, customer.id, rules), loyalty.history(db, customer.id, 1)]);
  return (
    <ClubPanel
      info={info}
      history={history.items}
      referralCode={customer.referralCode}
      pointsBalance={customer.pointsBalance}
      benefits={benefitsFor(info.tier, rules)}
    />
  );
}
