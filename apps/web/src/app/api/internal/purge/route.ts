import { AppError, ERROR_FA, decPath, encPath } from "@namilux/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { handler } from "@/lib/http-handler";

const MAX_URLS = 200;
const schema = z
  .union([
    z.object({ urls: z.array(z.string()).min(1).max(MAX_URLS) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ]);

const PRIVATE_IP =
  /^(?:$|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;

export const POST = handler({
  auth: "internal-hmac",
  schema,
  bodyCap: 16 * 1024,
  run: async ({ input, ip }) => {
    if (!PRIVATE_IP.test(ip)) throw new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN);

    // DECISION (from the header): the CDN purge is the worker's job - this route only clears Next's
    // own cache, so an incident can be handled without a deploy. `{ all: true }` revalidates the
    // root layout, which is the broadest hammer Next offers.
    if ("all" in input) {
      revalidatePath("/", "layout");
      return { ok: true, purged: 0 };
    }

    let purged = 0;
    for (const url of input.urls) {
      // A supplied URL may be absolute, encoded, or neither; normalise it the same way every other
      // emitted path is normalised so a purge cannot miss because of an encoding difference.
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      revalidatePath(encPath(decPath(path)));
      purged += 1;
    }
    return { ok: true, purged };
  },
});
