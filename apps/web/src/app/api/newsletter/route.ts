import { newsletter, newsletterSchema } from "@namilux/core";
import { issueChallenge } from "@namilux/integrations";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { powKey } from "@/lib/otp-config";
import { assertPow, powScope } from "@/lib/pow";

export const GET = handler({
  auth: "none",
  limit: [{ name: "pow.ip", key: ({ ip }) => ip }],
  run: ({ ip }) => Promise.resolve({ challenge: issueChallenge({ key: powKey() }, powScope("newsletter", ip)) }),
});

export const POST = handler({
  auth: "optional",
  schema: newsletterSchema,
  bodyCap: 2 * 1024,
  limit: [{ name: "contact.ip", key: ({ ip }) => ip }],
  run: async ({ input, user, ip }) => {
    assertPow(input.powToken, powScope("newsletter", ip));
    return newsletter.subscribe(db, { ...input, ip, customerId: user?.customerId ?? null });
  },
});
