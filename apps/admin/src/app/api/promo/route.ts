import { z } from "zod";
import {
  PROMO_BAR_MESSAGES_MAX,
  PROMO_BAR_ROTATE_SEC_MAX,
  PROMO_BAR_ROTATE_SEC_MIN,
  bannerSchema,
  getAllBanners,
  getSettings,
  replacePromoBar,
  tags,
} from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "marketing.banners",
  run: async () => {
    // every promo_bar row - switched off, scheduled and expired included; the editor manages them all
    const [messages, settings] = await Promise.all([getAllBanners(db, "promo_bar"), getSettings(db)]);
    return { messages, settings: settings["promo.bar"] };
  },
});

const schema = z
  .object({
    messages: z.array(bannerSchema).max(PROMO_BAR_MESSAGES_MAX),
    settings: z
      .object({ enabled: z.boolean(), rotateSec: z.number().int().min(PROMO_BAR_ROTATE_SEC_MIN).max(PROMO_BAR_ROTATE_SEC_MAX) })
      .strict(),
  })
  .strict();

/**
 * Replaces the whole announcement bar in one transaction (core `replacePromoBar`): the list sent is
 * the list stored, removed messages are deleted, nothing outside `promo_bar` is touched, and any
 * rejected message leaves every row and the setting as they were.
 */
export const PUT = adminHandler({
  schema,
  permission: "marketing.banners",
  bodyCap: 128 * 1024,
  run: async ({ input, staff, ip }) => {
    const actor = { type: "staff" as const, id: staff.id, ip };
    const result = await replacePromoBar(db, input, actor);
    const revalidate = new Set<string>([tags.nav, tags.home, tags.settings, ...result.tags]);
    return { ok: true, ids: result.ids, removed: result.removed.length, revalidate: [...revalidate] };
  },
});
