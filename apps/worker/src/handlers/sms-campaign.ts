import { createHash } from "node:crypto";
import { jobs, resolveSegment, smsCampaignSchema } from "@namilux/core";
import { segmentsFor } from "@namilux/integrations";
import { throwIfAborted } from "../runtime";
import type { Handler } from "../runtime";

export const SMS_UNIT_COST_TOMAN = 1_500;
/** Fallback spacing for a provider that declares no limit of its own. */
export const THROTTLE_MS = 250;

/**
 * FarazSMS throttles every route at 60 requests/minute and answers 429 above it, which at the old
 * fixed 250 ms (240/min) would have turned most of a campaign into failed jobs. Pace to whatever the
 * driver declares, with a little headroom.
 */
export function throttleMsFor(maxPerMinute: number | undefined): number {
  if (maxPerMinute === undefined || maxPerMinute <= 0) return THROTTLE_MS;
  return Math.max(THROTTLE_MS, Math.ceil(60_000 / maxPerMinute) + 50);
}
export const UNSUBSCRIBE_WORD = "لغو۱۱";

export const smsCampaign: Handler = async ({ db, drivers, log, job, signal }) => {
  const parsed = smsCampaignSchema.safeParse(job.payload);
  if (!parsed.success) {
    log.warn({ jobId: job.id }, "sms-campaign: malformed payload; nothing sent");
    return; // a retry cannot fix a bad payload
  }
  const input = parsed.data;
  const { phones, total } = await resolveSegment(db, input.segment);
  const throttleMs = throttleMsFor(drivers.sms.maxPerMinute);
  const perMessage = segmentsFor(`${input.text} · لغو: ${UNSUBSCRIBE_WORD}`) * SMS_UNIT_COST_TOMAN;
  const affordable = perMessage === 0 ? phones.length : Math.floor(input.budgetToman / perMessage);
  const recipients = phones.slice(0, Math.max(0, Math.min(phones.length, affordable)));
  const estimate = recipients.length * perMessage;

  if (input.dryRun) {
    log.info({ name: input.name, segment: total, recipients: recipients.length, estimate }, "sms-campaign dry run");
    return;
  }

  let enqueued = 0;
  for (const [i, phone] of recipients.entries()) {
    // A campaign fan-out is one INSERT per recipient and can run for minutes. The per-recipient
    // unique key makes every one of them idempotent, so stopping here and letting the retry finish
    // the list costs nothing and sends nobody a second message.
    if (signal.aborted) {
      log.warn({ name: input.name, enqueued, of: recipients.length }, "sms-campaign aborted mid fan-out; retry resumes");
      throwIfAborted(signal);
    }
    const key = `campaign:${job.id}:${createHash("sha256").update(phone).digest("hex").slice(0, 32)}`;
    await jobs.enqueue(
      db,
      "sms.send",
      { template: "campaign", phone, vars: { text: input.text, unsub: UNSUBSCRIBE_WORD } },
      { uniqueKey: key, runAt: new Date(Date.now() + i * throttleMs) },
    );
    enqueued += 1;
  }
  log.info(
    { name: input.name, segment: total, recipients: recipients.length, dropped: phones.length - recipients.length, enqueued, estimate, throttleMs },
    "sms-campaign fanned out",
  );
};
