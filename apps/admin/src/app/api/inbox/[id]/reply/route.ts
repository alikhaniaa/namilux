import { z } from "zod";
import { appError, concierge, contact, questions, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const schema = z
  .object({
    kind: z.enum(["concierge", "question", "contact"]).default("concierge"),
    answer: z.string().trim().max(2000).default(""),
    sendSms: z.boolean().default(false),
    publishPrice: z.number().int().min(0).optional(),
    promoteToFaq: z.boolean().default(false),
    hide: z.boolean().default(false),
    assignTo: z.string().nullable().optional(),
    snoozeUntil: z.string().datetime().optional(),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "inbox.reply",
  run: async ({ input, params, staff, ip }) => {
    const id = params.id ?? "";
    if (id === "") throw appError("VALIDATION", { details: { field: "id" } });
    const actor = { type: "staff" as const, id: staff.id, ip };
    const revalidate: string[] = [];
    if (input.kind === "concierge") {
      if (input.assignTo !== undefined) await concierge.assign(db, id, input.assignTo, actor);
      if (input.snoozeUntil !== undefined) await concierge.snooze(db, id, new Date(input.snoozeUntil), actor);
      if (input.answer !== "") {
        const opts: { sendSms: boolean; publishPrice?: number } = { sendSms: input.sendSms };
        if (input.publishPrice !== undefined) opts.publishPrice = input.publishPrice;
        await concierge.answer(db, id, input.answer, actor, opts);
        if (input.publishPrice !== undefined) revalidate.push(tags.catalog);
      }
    } else if (input.kind === "question") {
      if (input.hide) await questions.hide(db, id, actor);
      else {
        if (input.answer === "") throw appError("VALIDATION", { details: { field: "answer" } });
        await questions.answer(db, id, input.answer, actor, { sendSms: input.sendSms, promoteToFaq: input.promoteToFaq });
        revalidate.push(tags.catalog, tags.content);
      }
    } else {
      if (input.answer === "") throw appError("VALIDATION", { details: { field: "answer" } });
      await contact.answer(db, id, input.answer, actor, { sendSms: input.sendSms });
    }
    return { ok: true, revalidate };
  },
});
