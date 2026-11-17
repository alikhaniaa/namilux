import { z } from "zod";
import { resolveSegment, smsSegmentSchema } from "@namilux/core";
import { segmentsFor } from "@namilux/integrations";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const SMS_UNIT_COST_TOMAN = 1_500;
const UNSUBSCRIBE_LINE = " · لغو: لغو۱۱";

export const POST = adminHandler({
  schema: z.object({ segment: smsSegmentSchema, text: z.string().trim().min(1).max(300) }).strict(),
  permission: "marketing.sms",
  run: async ({ input }) => {
    const { total } = await resolveSegment(db, input.segment);
    const segments = segmentsFor(`${input.text}${UNSUBSCRIBE_LINE}`);
    const perMessage = segments * SMS_UNIT_COST_TOMAN;
    return { recipients: total, segments, perMessage, estimate: total * perMessage };
  },
});
