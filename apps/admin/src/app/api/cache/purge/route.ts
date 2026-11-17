import { z } from "zod";
import { jobs } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const schema = z
  .object({
    tags: z.array(z.string().min(1).max(120)).max(200).optional(),
    urls: z.array(z.string().min(1).max(2048)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "system.cache",
  sudo: false,
  run: async ({ input }) => {
    const payload: { tags?: string[]; urls?: string[]; all?: boolean } = {};
    if (input.tags !== undefined) payload.tags = input.tags;
    if (input.urls !== undefined) payload.urls = input.urls;
    if (input.all === true) payload.all = true;
    const jobId = await jobs.enqueue(db, "cdn.purge", payload);
    return { jobId };
  },
});
