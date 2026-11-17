import { AppError, ERROR_FA, trackRequestSchema } from "@namilux/core";
import { trackOrder } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const POST = handler({
  auth: "none",
  schema: trackRequestSchema,
  limit: [{ name: "track", key: ({ ip }) => ip }],
  run: async ({ input }) => {
    const view = await trackOrder(db, input.code, input.phone);
    if (view === null) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    return view;
  },
});
