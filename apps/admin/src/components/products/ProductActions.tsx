"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fa } from "@/i18n/fa";
import { api, ApiError } from "@/lib/api-client";
import { Button, Input } from "@/components/kit";
import { ConfirmButton } from "@/components/kit-client";

export function ProductActions({ id, archived }: { id: number; archived: boolean }) {
  const router = useRouter();
  const [redirectTo, setRedirectTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(unarchive: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/products/${id}/archive`, {
        method: "POST",
        body: unarchive ? { unarchive: true } : { redirectTo: redirectTo.trim() === "" ? null : redirectTo.trim() },
      });
      router.refresh();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : fa["common.error"]);
    } finally {
      setBusy(false);
    }
  }

  if (archived) {
    return (
      <div className="space-y-2">
        <Button variant="outline" onClick={() => void run(true)} disabled={busy}>
          خارج کردن از بایگانی
        </Button>
        {msg !== null ? <p className="text-sm text-[var(--danger)]">{msg}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input dir="ltr" aria-label={fa["products.archive.redirect"]} placeholder={fa["products.archive.redirect"]} value={redirectTo} onChange={(e) => setRedirectTo(e.target.value)} />
      <ConfirmButton label={fa["common.archive"]} confirmLabel="کالا از نمایش فروشگاه برداشته شود؟" onConfirm={() => run(false)} disabled={busy} />
      {msg !== null ? <p className="text-sm text-[var(--danger)]">{msg}</p> : null}
    </div>
  );
}
