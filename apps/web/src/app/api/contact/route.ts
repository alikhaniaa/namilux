import { contact, contactSchema } from "@namilux/core";
import { issueChallenge } from "@namilux/integrations";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { powKey } from "@/lib/otp-config";
import { assertPow, powScope } from "@/lib/pow";
import { CHANNEL } from "@/lib/channel";

export const GET = handler({
  auth: "none",
  limit: [{ name: "pow.ip", key: ({ ip }) => ip }],
  run: ({ ip }) => Promise.resolve({ challenge: issueChallenge({ key: powKey() }, powScope("contact", ip)) }),
});

export const POST = handler({
  auth: "optional",
  schema: contactSchema,
  bodyCap: 4 * 1024,
  limit: [{ name: "contact.ip", key: ({ ip }) => ip }],
  run: async ({ input, user, ip }) => {
    assertPow(input.powToken, powScope("contact", ip));
    return contact.submit(db, { ...input, ip, customerId: user?.customerId ?? null, channel: CHANNEL });
  },
});
