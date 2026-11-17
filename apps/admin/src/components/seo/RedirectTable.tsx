"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt, formatRelative } from "@namilux/core/client";
import type { Redirect } from "@namilux/core/client";
import { Button, EmptyRow, Input, Select, StatusBadge, Table, Td, Th, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { REDIRECT } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

export function RedirectTable({ items }: { items: Redirect[] }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [code, setCode] = useState<"301" | "410">("301");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(fromPath: string, toPath: string, c: 301 | 410): Promise<void> {
    await api("/api/seo/redirects", { method: "POST", body: { fromPath, toPath, code: c } });
  }

  async function submitOne(): Promise<void> {
    setBusy(true);
    try {
      await add(from.trim(), code === "410" ? "" : to.trim(), Number(code) as 301 | 410);
      toast(fa["redirects.saved"]);
      setFrom("");
      setTo("");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(): Promise<void> {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    const failedLines: string[] = [];
    for (const line of csv.split(/\r?\n/)) {
      const cells = line.split(",").map((c) => c.trim());
      if (cells.length < 2 || cells[0] === "" || cells[0] === "from") continue;
      try {
        await add(cells[0] ?? "", cells[1] ?? "", cells[2] === "410" ? 410 : 301);
        ok += 1;
      } catch {
        failed += 1;
        failedLines.push(line);
      }
    }
    setBusy(false);
    setCsv(failedLines.join("\n"));
    toast(`${fa["redirects.saved"]}: ${faInt(ok)} · ${fa["products.import.errors"]}: ${faInt(failed)}`, failed > 0 ? "error" : "ok");
    if (failed > 0) toast("ردیف‌های ناموفق در کادر باقی مانده‌اند. نشانی‌ها را اصلاح کنید و دوباره ثبت کنید.", "error");
    router.refresh();
  }

  async function toggle(r: Redirect): Promise<void> {
    try {
      await api(`/api/seo/redirects/${String(r.id)}`, { method: "PUT", body: { isActive: !r.isActive } });
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--ink-2)]">{REDIRECT.help}</p>
      <form
        className="flex flex-wrap items-end gap-2 border border-[var(--line)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submitOne();
        }}
      >
        <label className="text-xs">
          <span className="block text-[var(--ink-2)]">{fa["redirects.from"]}</span>
          <Input dir="ltr" className="w-64" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/old-page/" />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--ink-2)]">{fa["redirects.to"]}</span>
          <Input dir="ltr" className="w-64" value={code === "410" ? "" : to} disabled={code === "410"} onChange={(e) => setTo(e.target.value)} placeholder={code === "410" ? "مقصد لازم نیست" : "/shop/"} />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--ink-2)]">{fa["redirects.code"]}</span>
          <Select className="w-44" value={code} onChange={(e) => setCode(e.target.value as "301" | "410")}>
            <option value="301">{REDIRECT.code301}</option>
            <option value="410">{REDIRECT.code410}</option>
          </Select>
        </label>
        <Button type="submit" size="sm" disabled={busy || from.trim() === "" || (code === "301" && to.trim() === "") }>
          {fa["redirects.add"]}
        </Button>
        <p className="basis-full text-xs text-[var(--ink-2)]">{REDIRECT.code}</p>
      </form>
      <details className="border border-[var(--line)] p-3 text-sm">
        <summary className="cursor-pointer">{fa["redirects.import"]}</summary>
        <p className="mt-2 text-xs text-[var(--ink-2)]">{REDIRECT.csv}</p>
        <Textarea dir="ltr" className="mt-2 font-mono text-xs" rows={5} placeholder="/old-page/,/shop/,301" aria-label={REDIRECT.csvLabel} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <Button className="mt-2" size="sm" variant="outline" disabled={busy || csv.trim() === ""} onClick={() => void importCsv()}>
          {fa["common.import"]}
        </Button>
      </details>
      <Table minWidth={760}>
        <thead>
          <tr>
            <Th>{fa["redirects.from"]}</Th>
            <Th>{fa["redirects.to"]}</Th>
            <Th>{fa["redirects.code"]}</Th>
            <Th>{fa["redirects.source"]}</Th>
            <Th>{fa["redirects.hits"]}</Th>
            <Th>{fa["redirects.active"]}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-[var(--line)]">
              <Td ltr className="text-xs">
                {r.fromPath}
              </Td>
              <Td ltr className="text-xs">
                {r.toPath}
              </Td>
              <Td className="tabular-nums">{faInt(r.code)}</Td>
              <Td className="text-xs">{({ manual: "ثبت دستی", legacy: "فروشگاه قبلی", seed: "انتقال اولیه", auto_archive: "بایگانی خودکار" })[r.source] ?? "ثبت‌شده"}</Td>
              <Td className="text-xs tabular-nums">
                {faInt(r.hits)}
                {r.lastHitAt !== null ? <span className="ms-1 text-[var(--ink-3)]">{formatRelative(r.lastHitAt)}</span> : null}
              </Td>
              <Td>
                <button type="button" onClick={() => void toggle(r)}>
                  <StatusBadge tone={r.isActive ? "ok" : "muted"}>{r.isActive ? fa["common.active"] : fa["common.inactive"]}</StatusBadge>
                </button>
              </Td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={6} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
      {items.length > 0 ? <p className="text-xs text-[var(--ink-2)]">{REDIRECT.toggle}</p> : null}
    </div>
  );
}
