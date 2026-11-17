"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt } from "@namilux/core/client";
import { Button, EmptyRow, StatusBadge, Table, Td, Th, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";
import { fieldLabel } from "@/lib/error-detail";

type RowResult = { line: number; id: number | null; slug: string | null; action: string; changes: Record<string, { before: unknown; after: unknown }>; errors: string[] };
type Report = { dryRun: boolean; total: number; created: number; updated: number; skipped: number; errors: number; rows: RowResult[] };

const TEMPLATE = "id,slug,sku,price,compare_at_price,stock_qty,status,display_name\n";

function show(v: unknown): string {
  if (v === null || v === undefined) return "ثبت نشده";
  if (typeof v === "number") return faInt(v);
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  return typeof v === "string" ? v : "مقدار ثبت‌شده";
}

const columnLabel = (key: string): string => key === "stock_qty" ? "موجودی" : fieldLabel(key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())) ?? "اطلاعات کالا";
const importError = (text: string): string => text.replace(/«([a-z_]+)»/g, (_, key: string) => `«${columnLabel(key)}»`).replaceAll("CSV", "فایل جدولی").replaceAll("نامک", "نشانی صفحه");

export function ImportWizard() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean): Promise<void> {
    setBusy(true);
    try {
      const r = await api<Report>("/api/products/import", { method: "POST", body: { csv, dryRun } });
      setReport(r);
      if (!dryRun) {
        toast(`${fa["products.import.applied"]}: ${faInt(r.updated)}`);
        router.refresh();
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setCsv(await file.text());
    setReport(null);
  }

  return (
    <div className="space-y-4">
      <p className="ui-note">
        <span className="grow">فقط قیمت‌ها را عوض می‌کنید؟ فهرست قیمت را در «تغییر قیمت‌ها» بچسبانید؛ فایل و ستون‌بندی لازم ندارد.</span>
        <Link href="/products/prices/paste" className="ui-btn ui-btn--outline ui-btn--sm">ورود قیمت از فهرست</Link>
      </p>
      <p className="text-sm text-[var(--ink-2)]">این صفحه قیمت و موجودی کالاهای ثبت‌شده را به‌روزرسانی می‌کند. ابتدا «بررسی بدون اعمال» را بزنید. برای افزودن کالا از «محصول جدید» استفاده کنید؛ ردیف‌های کالای جدید را از فایل بردارید.</p>
      <div className="flex flex-wrap items-center gap-2">
        <a className="inline-flex h-8 items-center border border-[var(--line)] px-3 text-xs" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="namilux-products-template.csv">
          {fa["products.import.template"]}
        </a>
        <label className="inline-flex h-8 cursor-pointer items-center border border-[var(--line)] px-3 text-xs">
          {fa["products.import.file"]}
          <input disabled={busy} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
      <Textarea disabled={busy} dir="ltr" className="font-mono text-xs" rows={8} placeholder={fa["products.import.paste"]} value={csv} onChange={(e) => { setCsv(e.target.value); setReport(null); }} />
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || csv.trim() === ""} onClick={() => void run(true)}>
          {fa["products.import.dry"]}
        </Button>
        <Button disabled={busy || report === null || !report.dryRun || report.errors > 0 || report.created > 0 || report.updated === 0} onClick={() => void run(false)}>
          {fa["common.apply"]}
        </Button>
      </div>
      {report !== null ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <StatusBadge tone="ok">{fa["products.import.new"]}: {faInt(report.created)}</StatusBadge>
            <StatusBadge>{fa["products.import.changed"]}: {faInt(report.updated)}</StatusBadge>
            <StatusBadge tone="muted">{fa["products.bulk.skipped"]}: {faInt(report.skipped)}</StatusBadge>
            <StatusBadge tone={report.errors > 0 ? "warn" : "muted"}>{fa["products.import.errors"]}: {faInt(report.errors)}</StatusBadge>
          </div>
          <Table minWidth={800}>
            <thead>
              <tr>
                <Th>ردیف</Th>
                <Th>{fa["products.slug"]}</Th>
                <Th>{fa["common.status"]}</Th>
                <Th>{fa["products.import.changed"]}</Th>
                <Th>{fa["products.import.errors"]}</Th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.line} className="border-t border-[var(--line)] align-top">
                  <Td>{faInt(r.line)}</Td>
                  <Td ltr className="text-xs">
                    {r.slug ?? "نشانی ثبت نشده"}
                  </Td>
                  <Td>
                    <StatusBadge tone={r.errors.length > 0 || r.action === "create" ? "warn" : r.action === "skip" ? "muted" : "ok"}>{({create: "افزودن از فرم کالا لازم است", update: "به‌روزرسانی", skip: "بدون تغییر", error: "نیازمند اصلاح"})[r.action] ?? "بررسی شود"}</StatusBadge>
                  </Td>
                  <Td>
                    <ul className="text-xs">
                      {Object.entries(r.changes).map(([k, c]) => (
                        <li key={k}>
                          {columnLabel(k)}: از {show(c.before)} به {show(c.after)}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td className="text-xs text-[var(--danger)]">{r.errors.map(importError).join("، ")}</Td>
                </tr>
              ))}
              {report.rows.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
            </tbody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
