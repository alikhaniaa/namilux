"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SHIPMENT_CARRIERS, enDigits } from "@namilux/core/client";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Field, Input, Select } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function ShipmentForm({ code, onDone }: { code: string; onDone?: () => void }) {
  const router = useRouter();
  const [carrier, setCarrier] = useState<(typeof SHIPMENT_CARRIERS)[number]>("post");
  const [tracking, setTracking] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/orders/${code}/shipment`, {
        method: "POST",
        body: {
          carrier,
          ...(tracking.trim() === "" ? {} : { trackingCode: enDigits(tracking.trim()) }),
          ...(cost === null ? {} : { cost }),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
      });
      toast(fa["common.saved"]);
      onDone?.();
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={fa["orders.ship.carrier"]}>
        <Select value={carrier} onChange={(e) => setCarrier(e.target.value as (typeof SHIPMENT_CARRIERS)[number])}>
          {SHIPMENT_CARRIERS.map((c) => (
            <option key={c} value={c}>
              {fa[`orders.carrier.${c}`]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={fa["orders.ship.tracking"]}>
        <Input dir="ltr" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={120} />
      </Field>
      <MoneyInput label={fa["orders.ship.cost"]} value={cost} onChange={setCost} />
      <Field label={fa["orders.ship.note"]}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <Button type="submit" size="sm" disabled={busy}>
        {fa["orders.action.ship"]}
      </Button>
    </form>
  );
}
