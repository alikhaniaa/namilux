import "server-only";
import { getDb } from "@namilux/db";
import type { DbClient } from "@namilux/db";
import { env } from "@/env";

export const db: DbClient = getDb("admin", {
  url: env.DATABASE_URL_ADMIN,
  applicationName: "namilux-admin",
});
