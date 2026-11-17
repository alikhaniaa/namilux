import { type Db, and, desc, eq, gte, lte, smsLog as smsLogTable, sql } from "@namilux/db";
import type { Paged } from "./types";

export type SmsLogRow = {
  id: string;
  toMasked: string;
  template: string;
  provider: string;
  status: "queued" | "sent" | "failed";
  providerRef: string | null;
  cost: number | null;
  error: string | null;
  orderId: string | null;
  createdAt: string;
};

export const SMS_LOG_PAGE_SIZE = 50;

function mapRow(r: typeof smsLogTable.$inferSelect): SmsLogRow {
  return {
    id: r.id,
    toMasked: r.toMasked,
    template: r.template,
    provider: r.provider,
    status: r.status,
    providerRef: r.providerRef,
    cost: r.cost,
    error: r.error,
    orderId: r.orderId,
    createdAt: r.createdAt.toISOString(),
  };
}

function parseDate(v: string | undefined): Date | null {
  if (v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const smsLog = {
  async list(
    db: Db,
    q: { template?: string; status?: SmsLogRow["status"]; from?: string; to?: string; page?: number },
  ): Promise<Paged<SmsLogRow>> {
    const page = Math.max(1, q.page ?? 1);
    const conds = [];
    if (q.template !== undefined && q.template !== "") conds.push(eq(smsLogTable.template, q.template));
    if (q.status !== undefined) conds.push(eq(smsLogTable.status, q.status));
    const from = parseDate(q.from);
    if (from !== null) conds.push(gte(smsLogTable.createdAt, from));
    const to = parseDate(q.to);
    if (to !== null) conds.push(lte(smsLogTable.createdAt, to));
    const where = conds.length === 0 ? undefined : and(...conds);
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(smsLogTable)
        .where(where)
        .orderBy(desc(smsLogTable.createdAt))
        .limit(SMS_LOG_PAGE_SIZE)
        .offset((page - 1) * SMS_LOG_PAGE_SIZE),
      db.select({ n: sql<number>`count(*)::int` }).from(smsLogTable).where(where),
    ]);
    return { items: rows.map(mapRow), total: Number(totalRows[0]?.n ?? 0), page, pageSize: SMS_LOG_PAGE_SIZE };
  },

  async spend(db: Db, day: string): Promise<{ sent: number; failed: number; costToman: number; otpSends: number }> {
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    const rows = await db
      .select({
        sent: sql<number>`count(*) filter (where ${smsLogTable.status} = 'sent')::int`,
        failed: sql<number>`count(*) filter (where ${smsLogTable.status} = 'failed')::int`,
        cost: sql<number>`coalesce(sum(${smsLogTable.cost}) filter (where ${smsLogTable.status} = 'sent'), 0)::bigint`,
        otp: sql<number>`count(*) filter (where ${smsLogTable.template} = 'otp')::int`,
      })
      .from(smsLogTable)
      .where(and(gte(smsLogTable.createdAt, start), lte(smsLogTable.createdAt, end)));
    const r = rows[0];
    return { sent: Number(r?.sent ?? 0), failed: Number(r?.failed ?? 0), costToman: Number(r?.cost ?? 0), otpSends: Number(r?.otp ?? 0) };
  },

  async forOrder(db: Db, orderId: string): Promise<SmsLogRow[]> {
    const rows = await db.select().from(smsLogTable).where(eq(smsLogTable.orderId, orderId)).orderBy(desc(smsLogTable.createdAt)).limit(50);
    return rows.map(mapRow);
  },
};
