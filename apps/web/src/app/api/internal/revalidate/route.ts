import { AppError, ERROR_FA } from "@namilux/core";
import { z } from "zod";
import { handler } from "@/lib/http-handler";
import { revalidateTags } from "@/lib/cache";

const MAX_TAGS = 200;
const schema = z.object({ tags: z.array(z.string()).min(1).max(MAX_TAGS) }).strict();

/**
 * Two gates, not one: the HMAC proves the caller holds INTERNAL_SIGNING_KEY, and the private-address
 * check means a leaked key is still not enough from the public internet. Caddy blocks the path at
 * the edge as well - this is the app-level belt behind that brace.
 */
const PRIVATE_IP =
  /^(?:$|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;

export const POST = handler({
  auth: "internal-hmac",
  schema,
  bodyCap: 16 * 1024,
  run: async ({ input, ip }) => {
    if (!PRIVATE_IP.test(ip)) throw new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN);
    // revalidateTags re-validates every tag against the core grammar before it reaches Next's cache.
    await revalidateTags(input.tags);
    return { revalidated: input.tags.length };
  },
});
