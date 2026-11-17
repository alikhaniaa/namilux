import { listMedia } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "catalog.read",
  run: ({ req }) => {
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind");
    const page = Number(sp.get("page") ?? "1");
    const quarantined = sp.get("quarantined");
    return listMedia(db, {
      ...(sp.get("q") === null ? {} : { q: sp.get("q") ?? "" }),
      ...(kind === "image" || kind === "video" || kind === "file" ? { kind } : {}),
      ...(quarantined === "1" ? { quarantined: true } : quarantined === "0" ? { quarantined: false } : {}),
      ...(sp.get("unused") === "1" ? { unused: true } : {}),
      page: Number.isInteger(page) && page > 0 ? page : 1,
    });
  },
});
