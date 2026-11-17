import { appError, channelScope, customerDetail } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "customers.read",
  run: ({ params, staff }) => {
    const id = params.id ?? "";
    if (id === "") throw appError("VALIDATION", { details: { field: "id" } });
    const site = channelScope(staff);
    return customerDetail(db, id, site === null ? {} : { channel: site });
  },
});
