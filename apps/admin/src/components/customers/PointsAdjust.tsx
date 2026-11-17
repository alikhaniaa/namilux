"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { enDigits } from "@namilux/core/client";
import { Button, Field, Input } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function PointsAdjust({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/customers/${customerId}/points`, { method: "POST", body: { delta: Number(enDigits(delta)), note } });
      toast(fa["customers.points.done"]);
      setOpen(false);
      setDelta("");
      setNote("");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {fa["customers.points.adjust"]}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={fa["customers.points.adjust"]}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {fa["common.cancel"]}
            </Button>
            <Button disabled={busy || note.trim().length < 3 || Number(enDigits(delta)) === 0} onClick={() => void submit()}>
              {fa["common.confirm"]}
            </Button>
          </>
        }
      >
        <Field label={fa["customers.points.delta"]}>
          <Input dir="ltr" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+۵۰۰ / -۲۰۰" />
        </Field>
        <Field label={fa["customers.points.note"]}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
      </Dialog>
    </>
  );
}
