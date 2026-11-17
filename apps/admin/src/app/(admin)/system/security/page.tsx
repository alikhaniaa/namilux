import { securityLabel } from "@/i18n/admin-labels";
import { security, SECURITY_EVENT_KINDS } from "@namilux/core";
import type { SecurityEventKind } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { SecurityEventsTable } from "@/components/system/SecurityEventsTable";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function SecurityPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("audit.read");
  const sp = await searchParams;
  const kind = first(sp.kind);
  const from = first(sp.from);
  const to = first(sp.to);
  const list = await security.list(db, {
    page: Math.max(1, Number(first(sp.page)) || 1),
    ...(kind === undefined || kind === "" ? {} : { kind: kind as SecurityEventKind }),
    ...(from === undefined || from === "" ? {} : { from }),
    ...(to === undefined || to === "" ? {} : { to }),
  });
  return (
    <div>
      <PageHeader title={fa["nav.security"]} count={list.total} />
      <Filters
        defs={[
          { key: "kind", label: fa["security.kind"], kind: "select", options: SECURITY_EVENT_KINDS.map(value => ({ value, label: securityLabel(value) })) },
          { key: "from", label: fa["filters.from"], kind: "date" },
          { key: "to", label: fa["filters.to"], kind: "date" },
        ]}
      />
      <SecurityEventsTable items={list.items} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
