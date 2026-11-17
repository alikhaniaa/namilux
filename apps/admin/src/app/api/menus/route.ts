import { getMenus, menuSchema, setMenu } from "@namilux/core";
import type { MenuItem } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({ permission: "content.write", run: () => getMenus(db) });
export const PUT = adminHandler({
  schema: menuSchema,
  permission: "content.write",
  run: async ({ input, staff, ip }) => {
    const { tags } = await setMenu(db, input.key, input.items as unknown as MenuItem[], { type: "staff", id: staff.id, ip });
    return { ok: true, tags, revalidate: tags };
  },
});
