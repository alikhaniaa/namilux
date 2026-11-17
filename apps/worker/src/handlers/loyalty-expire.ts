import { getSettings, loyalty } from "@namilux/core";
import type { Handler } from "../runtime";

export const loyaltyExpire: Handler = async ({ db, log }) => {
  const settings = await getSettings(db);
  const result = await loyalty.expire(db, new Date(), settings["loyalty.rules"]);
  log.info({ customers: result.customers, points: result.points }, "loyalty.expire done");
};
