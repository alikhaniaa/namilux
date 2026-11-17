import type { Env } from "@namilux/config";
import { getSettings, quote, quoteRequestSchema } from "@namilux/core";
import { CHANNEL } from "@/lib/channel";
import { db } from "@/lib/db";
import { env } from "@/env";
import { handler } from "@/lib/http-handler";

export const POST = handler({
  auth: "optional", // the spec optional session: guests may quote; a signed-in shopper's coupon/points/address need identity (resolved here, used inside quote())
  schema: quoteRequestSchema,
  bodyCap: 8 * 1024,
  limit: [{ name: "checkout.quote", key: ({ ip }) => ip }],
  run: async ({ input, user }) => {
    const settings = await getSettings(db);
    return quote(db, input, {
      ...(user !== null ? { customerId: user.customerId, phone: user.phone } : {}),
      settings,
      env: env as unknown as Env,
      channel: CHANNEL,
    });
  },
});
