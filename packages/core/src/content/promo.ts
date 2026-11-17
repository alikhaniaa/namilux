import { and, banners as bannersTable, eq, inArray, sql } from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Actor } from "../types";
import type { BannerInput } from "../types";
import { appError, isAppError } from "../errors";
import { audit } from "../audit";
import { tags as cacheTags } from "../cache/tags";
import { setSetting } from "../settings/service";
import { upsertBanner } from "./banners";
import {
  PROMO_BAR_MESSAGES_MAX,
  PROMO_BAR_ROTATE_SEC_MAX,
  PROMO_BAR_ROTATE_SEC_MIN,
  PROMO_BAR_SLOT,
  promoFaultFa,
} from "./promo-copy";

export type PromoBarSettingsInput = { enabled: boolean; rotateSec: number };
export const PROMO_LOCK_KEY = "namilux:banners:promo_bar:replace";

/**
 * The announcement bar is edited as ONE list: what the editor sends is what the slot holds
 * afterwards. Rows missing from the list are deleted, rows present are updated in list order,
 * rows without an id are created, and the bar's on/off + rotation setting is written - all in one
 * transaction, so a rejected message leaves the slot and the setting exactly as they were.
 *
 * Only `promo_bar` rows are ever touched: an id that belongs to another slot (or to nothing) is
 * refused before the first write, so this endpoint can never move or delete a hero/band banner.
 *
 * DECISION: a removed row is deleted even while active - unlike `deleteBanner`'s "switch it off
 * first" guard - because here removal is an explicit, reviewed edit of the whole slot (the editor
 * shows the list and the live preview before saving), not a one-click delete from a table.
 */
export async function replacePromoBar(
  db: Db,
  input: { messages: readonly BannerInput[]; settings: PromoBarSettingsInput },
  actor: Actor,
): Promise<{ ids: number[]; removed: number[]; tags: string[] }> {
  const { messages, settings } = input;

  // ---- everything that can be judged without the database, before the transaction opens
  if (messages.length > PROMO_BAR_MESSAGES_MAX) fail("messages", "too_many", { max: PROMO_BAR_MESSAGES_MAX });
  const { rotateSec } = settings;
  if (!Number.isInteger(rotateSec) || rotateSec < PROMO_BAR_ROTATE_SEC_MIN || rotateSec > PROMO_BAR_ROTATE_SEC_MAX) {
    fail("settings.rotateSec", "out_of_range");
  }
  const seen = new Set<number>();
  messages.forEach((m, i) => {
    if (m.slot !== PROMO_BAR_SLOT) fail(`messages.${String(i)}.slot`, "slot_mismatch", { index: i });
    if (m.id !== undefined) {
      if (seen.has(m.id)) fail(`messages.${String(i)}.id`, "duplicate", { index: i });
      seen.add(m.id);
    }
  });

  return db.transaction(async (tx) => {
    // Row locks alone cannot serialize two first saves into an empty slot.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROMO_LOCK_KEY}))`);
    const current = await tx
      .select({ id: bannersTable.id, title: bannersTable.title, isActive: bannersTable.isActive })
      .from(bannersTable)
      .where(eq(bannersTable.slot, PROMO_BAR_SLOT))
      .for("update");
    const inSlot = new Set(current.map((r) => r.id));

    // every id is checked before the first write - no half-applied list
    messages.forEach((m, i) => {
      if (m.id !== undefined && !inSlot.has(m.id)) fail(`messages.${String(i)}.id`, "not_in_slot", { index: i, id: m.id });
    });

    const removedRows = current.filter((r) => !seen.has(r.id));
    const removed = removedRows.map((r) => r.id);
    if (removed.length > 0) {
      await tx
        .delete(bannersTable)
        .where(and(eq(bannersTable.slot, PROMO_BAR_SLOT), inArray(bannersTable.id, removed)));
      for (const r of removedRows) {
        await audit.log(tx, actor, "banner.delete", "banner", String(r.id), { slot: PROMO_BAR_SLOT, title: r.title, isActive: r.isActive }, null);
      }
    }

    const tags = new Set<string>([cacheTags.content, cacheTags.home]);
    const ids: number[] = [];
    for (const [i, m] of messages.entries()) {
      try {
        const r = await upsertBanner(tx, { ...m, slot: PROMO_BAR_SLOT, sort: i }, actor);
        ids.push(r.id);
        for (const t of r.tags) tags.add(t);
      } catch (e) {
        throw atIndex(e, i);
      }
    }

    const s = await setSetting(tx, "promo.bar", { enabled: settings.enabled, rotateSec }, actor);
    for (const t of s.tags) tags.add(t);

    return { ids, removed, tags: [...tags] };
  });
}

function fail(field: string, reason: string, extra?: Record<string, unknown>): never {
  const index = extra?.index;
  const fa = promoFaultFa(field, reason);
  throw appError("VALIDATION", {
    fa: typeof index === "number" ? `پیام ${faOrdinal(index + 1)}: ${fa}` : fa,
    details: { field, reason, ...extra, fieldErrors: [{ path: field, message: fa }] },
  });
}

/**
 * `upsertBanner` names the field of ONE banner (`endsAt`); the editor holds a list, so the field is
 * re-pathed to `messages.<i>.endsAt` and the message states the rule in Persian - the generic
 * «اطلاعات ارسال‌شده معتبر نیست.» told the owner nothing.
 */
function atIndex(e: unknown, i: number): unknown {
  if (!isAppError(e) || e.code !== "VALIDATION") return e;
  const d = (typeof e.details === "object" && e.details !== null ? e.details : {}) as Record<string, unknown>;
  const leaf = typeof d.field === "string" ? d.field : "title";
  const reason = typeof d.reason === "string" ? d.reason : "invalid";
  const field = `messages.${String(i)}.${leaf}`;
  const fa = promoFaultFa(field, reason);
  return appError("VALIDATION", {
    fa: `پیام ${faOrdinal(i + 1)}: ${fa}`,
    // `fieldErrors` is the admin client's {path, message} list - the editor pins it under the field
    details: { ...d, field, reason, index: i, fieldErrors: [{ path: field, message: fa }] },
  });
}

function faOrdinal(n: number): string {
  return String(n).replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)] ?? c);
}
