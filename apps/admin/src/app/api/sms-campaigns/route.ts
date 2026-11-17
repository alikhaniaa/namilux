import { audit, jobs, smsCampaignSchema } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "marketing.sms",
  run: async ({ req }) => {
    const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
    const list = await jobs.list(db, { type: "sms.campaign", page: Number.isInteger(page) && page > 0 ? page : 1 });
    return {
      ...list,
      items: list.items.map((j) => ({
        id: j.id,
        status: j.status,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
        name: typeof j.payload.name === "string" ? j.payload.name : "",
        text: typeof j.payload.text === "string" ? j.payload.text : "",
        budgetToman: typeof j.payload.budgetToman === "number" ? j.payload.budgetToman : 0,
        dryRun: j.payload.dryRun === true,
        lastError: j.lastError,
      })),
    };
  },
});

export const POST = adminHandler({
  schema: smsCampaignSchema,
  permission: "marketing.sms",
  run: async ({ input, staff, ip }) => {
    const id = await jobs.enqueue(db, "sms.campaign", JSON.parse(JSON.stringify(input)) as Record<string, never>);
    await audit.log(db, { type: "staff", id: staff.id, ip }, "sms.campaign.enqueue", "jobs", id, null, { name: input.name, budgetToman: input.budgetToman, dryRun: input.dryRun });
    return { jobId: id };
  },
});
