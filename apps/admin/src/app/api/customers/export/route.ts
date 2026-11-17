import { AppError, ERROR_FA, assertCan, audit, customersRepo, requiresSudo, verifySudoToken, SUDO_COOKIE, faInt } from "@namilux/core";
import type { CustomerQuery, CustomerTier } from "@namilux/core";
import { csrfCheck } from "@/lib/csrf";
import { db } from "@/lib/db";
import { env } from "@/env";
import { adminHandler, clientIp, fail } from "@/lib/http-handler";
import { currentStaff } from "@/lib/session";
import { sudoRequired } from "@/lib/authz";

function parse(sp: URLSearchParams): CustomerQuery {
  const q: CustomerQuery = { page: 1, pageSize: 200 };
  const text = sp.get("q");
  if (text !== null && text.trim() !== "") q.q = text;
  const tier = sp.get("tier");
  if (tier !== null && tier !== "") q.tier = tier.split(",") as CustomerTier[];
  const blocked = sp.get("blocked");
  if (blocked === "1") q.blocked = true;
  if (blocked === "0") q.blocked = false;
  const optIn = sp.get("optIn");
  if (optIn === "1") q.optIn = true;
  if (optIn === "0") q.optIn = false;
  return q;
}

/** The probe rides the standard pipeline (permission + sudo + envelope). */
export const probe = adminHandler({ permission: "customers.export", sudo: true, run: async () => ({ ok: true }) });

export async function GET(req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get("probe") === "1") return probe(req, ctx);
  void csrfCheck;
  const staff = await currentStaff();
  if (staff === null) return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED));
  try {
    assertCan(staff, "customers.export");
  } catch (e) {
    return fail(e instanceof AppError ? e : new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
  }
  if (requiresSudo("customers.export")) {
    const raw = req.headers.get("cookie") ?? "";
    const token = raw.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${SUDO_COOKIE}=`))?.slice(SUDO_COOKIE.length + 1);
    if (token === undefined || verifySudoToken(token, staff.sessionId, env.SESSION_PEPPER) === null) return fail(sudoRequired("customers.export"));
  }
  const q = parse(url.searchParams);
  await audit.log(db, { type: "staff", id: staff.id, ip: clientIp(req) }, "customers.export", "customers", "*", null, { q });

  const encoder = new TextEncoder();
  const cell = (v: string | number | boolean | null): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("﻿id,name,phone,tier,orders,spend,lastOrder,optIn,blocked\n"));
      for await (const r of customersRepo.exportRows(db, q)) {
        controller.enqueue(
          encoder.encode(
            `${[cell(r.id), cell(r.name), cell(r.phoneMasked), cell(r.tier), cell(faInt(r.ordersCount)), cell(faInt(r.lifetimeSpend)), cell(r.lastOrderAt ?? ""), cell(r.marketingOptIn), cell(r.isBlocked)].join(",")}\n`,
          ),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
