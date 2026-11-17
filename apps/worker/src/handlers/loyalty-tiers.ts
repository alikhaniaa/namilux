import { getSettings, grantBirthdayCoupons, recomputeTiers } from "@namilux/core";
import type { Handler } from "../runtime";

export const loyaltyTiers: Handler = async ({ db, log }) => {
  const settings = await getSettings(db);
  const rules = settings["loyalty.rules"];
  const now = new Date();
  const tiers = await recomputeTiers(db, now, rules);
  const birthdays = await grantBirthdayCoupons(db, now, rules);
  log.info({ upgraded: tiers.upgraded, downgraded: tiers.downgraded, birthdays }, "loyalty.tiers done");
};
