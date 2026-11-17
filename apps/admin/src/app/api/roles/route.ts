import { MONEY_PERMISSIONS, PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, SUDO_PERMISSIONS } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";

export const GET = adminHandler({
  permission: "staff.manage",
  run: async () => ({ roles: ROLE_NAMES, permissions: PERMISSIONS, matrix: ROLE_PERMISSIONS, sudo: SUDO_PERMISSIONS, money: MONEY_PERMISSIONS }),
});
