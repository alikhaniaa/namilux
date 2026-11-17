import { AppError, ERROR_FA, deleteMedia, getMediaAdmin, mediaAltSchema, setMediaAlt, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const idOf = (params: Record<string, string>): string => {
  const id = params.id ?? "";
  if (id === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
  return id;
};

export const GET = adminHandler({
  permission: "catalog.read",
  run: async ({ params }) => {
    const row = await getMediaAdmin(db, idOf(params));
    if (row === null) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    return row;
  },
});

export const PUT = adminHandler({
  schema: mediaAltSchema,
  permission: "media.write",
  run: async ({ input, params, staff, ip }) => {
    await setMediaAlt(db, idOf(params), input.alt, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.catalog] };
  },
});

export const DELETE = adminHandler({
  permission: "media.delete",
  run: async ({ params, staff, ip }) => {
    await deleteMedia(db, idOf(params), { type: "staff", id: staff.id, ip });
    return { ok: true };
  },
});
