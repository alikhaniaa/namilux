import { type Row, type Db, addresses as addressesTable, and, count, desc, eq } from "@namilux/db";
import { appError } from "../errors";
import { canonicalCity, isProvinceCode } from "../geo/provinces";
import { ulid } from "../ids";
import { normalizePhone, normalizePostcode } from "../persian";
import type { Address, OrderAddressSnapshot } from "../types";
import type { AddressInput } from "../validation/address";

export const MAX_ADDRESSES = 10;

type AddressRowSource = Row<typeof addressesTable>;

function toAddress(r: AddressRowSource): Address {
  return {
    id: r.id,
    customerId: r.customerId,
    label: r.label,
    recipientName: r.recipientName,
    recipientPhone: r.recipientPhone,
    province: r.province as Address["province"],
    city: r.city,
    address: r.address,
    plaque: r.plaque,
    unit: r.unit,
    postcode: r.postcode,
    isDefault: r.isDefault,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
  };
}

/** Canonicalize + defensively re-validate the geo/phone/postcode fields (belt over the zod schema). */
function normalizeInput(input: AddressInput): {
  label: string;
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  address: string;
  plaque: string | null;
  unit: string | null;
  postcode: string;
  isDefault: boolean;
} {
  if (!isProvinceCode(input.province)) {
    throw appError("VALIDATION", { fa: "استان معتبر نیست", details: { field: "province" } });
  }
  const city = canonicalCity(input.province, input.city);
  if (city === null) {
    throw appError("VALIDATION", { fa: "شهر با استان هم‌خوانی ندارد", details: { field: "city" } });
  }
  const phone = normalizePhone(input.recipientPhone);
  if (phone === null) {
    throw appError("VALIDATION", { fa: "شمارهٔ گیرنده معتبر نیست", details: { field: "recipientPhone" } });
  }
  const postcode = normalizePostcode(input.postcode);
  if (postcode === null) {
    throw appError("VALIDATION", { fa: "کد پستی باید ۱۰ رقم باشد", details: { field: "postcode" } });
  }
  return {
    label: input.label,
    recipientName: input.recipientName,
    recipientPhone: phone,
    province: input.province,
    city,
    address: input.address,
    plaque: input.plaque ?? null,
    unit: input.unit ?? null,
    postcode,
    isDefault: input.isDefault,
  };
}

async function countFor(db: Db, customerId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(addressesTable)
    .where(eq(addressesTable.customerId, customerId));
  return rows[0]?.n ?? 0;
}

export const addresses = {
  async list(db: Db, customerId: string): Promise<Address[]> {
    const rows = await db
      .select()
      .from(addressesTable)
      .where(eq(addressesTable.customerId, customerId))
      .orderBy(desc(addressesTable.isDefault), desc(addressesTable.createdAt));
    return rows.map(toAddress);
  },
  async get(db: Db, customerId: string, id: string): Promise<Address | null> {
    const rows = await db
      .select()
      .from(addressesTable)
      .where(and(eq(addressesTable.id, id), eq(addressesTable.customerId, customerId)))
      .limit(1);
    return rows[0] === undefined ? null : toAddress(rows[0]);
  },
  async create(db: Db, customerId: string, input: AddressInput): Promise<Address> {
    const existing = await countFor(db, customerId);
    if (existing >= MAX_ADDRESSES) {
      throw appError("VALIDATION", { fa: "حداکثر ۱۰ نشانی می‌توانید ذخیره کنید" });
    }
    const clean = normalizeInput(input);
    const makeDefault = existing === 0 || clean.isDefault;
    return db.transaction(async (tx) => {
      if (makeDefault) {
        await tx
          .update(addressesTable)
          .set({ isDefault: false })
          .where(eq(addressesTable.customerId, customerId));
      }
      const rows = await tx
        .insert(addressesTable)
        .values({ id: ulid(), customerId, ...clean, isDefault: makeDefault })
        .returning();
      const created = rows[0];
      if (created === undefined) throw appError("INTERNAL", { fa: "خطای داخلی" });
      return toAddress(created);
    });
  },
  async update(db: Db, customerId: string, id: string, input: AddressInput): Promise<Address> {
    const clean = normalizeInput(input);
    return db.transaction(async (tx) => {
      const current = await tx
        .select({ id: addressesTable.id })
        .from(addressesTable)
        .where(and(eq(addressesTable.id, id), eq(addressesTable.customerId, customerId)))
        .limit(1);
      if (current[0] === undefined) throw appError("NOT_FOUND", { fa: "نشانی پیدا نشد" });
      if (clean.isDefault) {
        await tx
          .update(addressesTable)
          .set({ isDefault: false })
          .where(eq(addressesTable.customerId, customerId));
      }
      const rows = await tx
        .update(addressesTable)
        .set({ ...clean })
        .where(and(eq(addressesTable.id, id), eq(addressesTable.customerId, customerId)))
        .returning();
      const updated = rows[0];
      if (updated === undefined) throw appError("NOT_FOUND", { fa: "نشانی پیدا نشد" });
      return toAddress(updated);
    });
  },
  async remove(db: Db, customerId: string, id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const rows = await tx
        .delete(addressesTable)
        .where(and(eq(addressesTable.id, id), eq(addressesTable.customerId, customerId)))
        .returning({ wasDefault: addressesTable.isDefault });
      if (rows[0]?.wasDefault) {
        // promote the newest remaining address to default
        const next = await tx
          .select({ id: addressesTable.id })
          .from(addressesTable)
          .where(eq(addressesTable.customerId, customerId))
          .orderBy(desc(addressesTable.createdAt))
          .limit(1);
        if (next[0] !== undefined) {
          await tx.update(addressesTable).set({ isDefault: true }).where(eq(addressesTable.id, next[0].id));
        }
      }
    });
  },
  async setDefault(db: Db, customerId: string, id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: addressesTable.id })
        .from(addressesTable)
        .where(and(eq(addressesTable.id, id), eq(addressesTable.customerId, customerId)))
        .limit(1);
      if (owned[0] === undefined) throw appError("NOT_FOUND", { fa: "نشانی پیدا نشد" });
      await tx.update(addressesTable).set({ isDefault: false }).where(eq(addressesTable.customerId, customerId));
      await tx.update(addressesTable).set({ isDefault: true }).where(eq(addressesTable.id, id));
    });
  },
  snapshot(a: Address): OrderAddressSnapshot {
    return {
      label: a.label,
      recipientName: a.recipientName,
      recipientPhone: a.recipientPhone,
      province: a.province,
      city: a.city,
      address: a.address,
      plaque: a.plaque,
      unit: a.unit,
      postcode: a.postcode,
    };
  },
};
