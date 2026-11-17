import { type Db, and, desc, eq, or, productModels, products, sql } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import type { Actor } from "../types";
import { modelKey } from "./models";
import { faNorm } from "../persian";

export type ModelGroup = {
  id: number;
  key: string;
  displayName: string;
  brandId: number | null;
  primaryProductId: number | null;
  members: { id: number; displayName: string; colorName: string | null }[];
};

export async function listModels(db: Db, q: { q?: string; brandId?: number; id?: number; limit?: number }): Promise<ModelGroup[]> {
  const conds = [];
  if (q.id !== undefined) conds.push(eq(productModels.id, q.id));
  if (q.q !== undefined && q.q.trim() !== "") {
    const like = `%${faNorm(q.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(sql`nl_fa_norm(${productModels.displayName}) like ${like}`, sql`nl_fa_norm(${productModels.key}) like ${like}`));
  }
  if (q.brandId !== undefined) conds.push(eq(productModels.brandId, q.brandId));
  const groups = await db
    .select()
    .from(productModels)
    .where(conds.length === 0 ? undefined : and(...conds))
    .orderBy(desc(productModels.id))
    .limit(Math.min(100, q.limit ?? 20));
  if (groups.length === 0) return [];
  const members = await db
    .select({ id: products.id, modelId: products.modelId, displayName: products.displayName, colorName: products.colorName })
    .from(products)
    .where(sql`${products.modelId} in (${sql.join(groups.map((g) => sql`${g.id}`), sql`, `)})`);
  return groups.map((g) => ({
    id: g.id,
    key: g.key,
    displayName: g.displayName,
    brandId: g.brandId,
    primaryProductId: g.primaryProductId,
    members: members.filter((m) => m.modelId === g.id).map(({ id, displayName, colorName }) => ({ id, displayName, colorName })),
  }));
}

export async function createModel(db: Db, i: { displayName: string; brandId: number | null }, actor: Actor): Promise<{ id: number }> {
  const name = i.displayName.trim();
  if (name === "") throw appError("VALIDATION", { fa: "نام گروه لازم است" });
  let key = modelKey({ name, displayName: name, sku: null, modelCode: null });
  if (key === "") key = name.toLowerCase();
  const dupe = await db.select({ id: productModels.id }).from(productModels).where(eq(productModels.key, key)).limit(1);
  // product_models.key is UNIQUE while a group is really (key, brand): suffix the brand when taken (models.ts DECISION).
  if (dupe[0] !== undefined) key = `${key}#${String(i.brandId ?? 0)}`;
  const inserted = await db.insert(productModels).values({ key, displayName: name, brandId: i.brandId }).returning({ id: productModels.id });
  const id = inserted[0]?.id;
  if (id === undefined) throw appError("INTERNAL");
  await audit.log(db, actor, "model.create", "product_models", String(id), null, { key, displayName: name, brandId: i.brandId });
  return { id };
}
