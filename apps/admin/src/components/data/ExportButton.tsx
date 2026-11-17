"use client";
import { useState } from "react";
import { Button } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function ExportButton({ href, permission, allowed = true }: { href: string; permission: string; allowed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const url = `${href}${href.includes("?") ? "&" : "?"}format=csv`;
  async function go(): Promise<void> {
    setBusy(true);
    try {
      await api(`${url}&probe=1`);
      window.location.assign(url);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" disabled={!allowed || busy} onClick={() => void go()} title={permission}>
      {fa["export.csv"]}
    </Button>
  );
}
