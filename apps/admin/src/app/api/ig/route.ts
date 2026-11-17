import { z } from "zod";
import { bannerSchema } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";
import { listIgCards, replaceIgCards } from "@/lib/ig-service";

export const GET = adminHandler({
  permission: "marketing.banners",
  run: async () => ({ cards: await listIgCards(db) }),
});

/** The editor sends the whole list: saved cards it no longer carries are removed (see replaceIgCards). */
export const PUT = adminHandler({
  schema: z.object({ cards: z.array(bannerSchema).max(60) }).strict(),
  permission: "marketing.banners",
  bodyCap: 256 * 1024,
  run: async ({ input, staff, ip }) => replaceIgCards(db, input.cards, { type: "staff", id: staff.id, ip }),
});
