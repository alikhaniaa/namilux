import { SMS_TEMPLATES, dayKey, smsLog } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { SmsLogTable } from "@/components/system/SmsLogTable";
import { PageHeader } from "@/components/kit";
import { fa, smsTemplateLabel } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function SmsLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("audit.read");
  const sp = await searchParams;
  const template = first(sp.template);
  const status = first(sp.status);
  const from = first(sp.from);
  const to = first(sp.to);
  const [list, spend] = await Promise.all([
    smsLog.list(db, {
      page: Math.max(1, Number(first(sp.page)) || 1),
      ...(template === undefined || template === "" ? {} : { template }),
      ...(status === "queued" || status === "sent" || status === "failed" ? { status } : {}),
      ...(from === undefined || from === "" ? {} : { from }),
      ...(to === undefined || to === "" ? {} : { to }),
    }),
    smsLog.spend(db, dayKey(new Date())),
  ]);
  return (
    <div>
      <PageHeader title={fa["nav.smsLog"]} count={list.total} />
      <Filters
        defs={[
          { key: "template", label: fa["smsLog.template"], kind: "select", options: SMS_TEMPLATES.map((t) => ({ value: t, label: smsTemplateLabel(t) })) },
          { key: "status", label: fa["common.status"], kind: "select", options: ["queued", "sent", "failed"].map((s) => ({ value: s, label: s })) },
          { key: "from", label: fa["filters.from"], kind: "date" },
          { key: "to", label: fa["filters.to"], kind: "date" },
        ]}
      />
      <SmsLogTable items={list.items} spend={spend} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
