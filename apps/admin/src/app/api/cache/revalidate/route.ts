import { z } from "zod";
import { adminHandler } from "@/lib/http-handler";
import { send } from "@/lib/revalidate-client";

const schema = z.object({ tags: z.array(z.string().min(1).max(120)).min(1).max(200) }).strict();

export const POST = adminHandler({
  schema,
  permission: "system.cache",
  run: ({ input }) => send(input.tags),
});
