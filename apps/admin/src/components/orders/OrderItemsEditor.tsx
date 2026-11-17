"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderItem } from "@namilux/core/client";
import { enDigits, faInt, formatToman } from "@namilux/core/client";
import { ProductPicker } from "@/components/products/ProductPicker";
import { Button, Input } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

type Line = { productId: number; name: string; qty: number; unitPrice: number; override: string };

export function OrderItemsEditor({ code, items, canOverride }: { code: string; items: OrderItem[]; canOverride: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, unitPrice: i.unitPrice, override: "" })));
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/orders/${code}/items`, {
        method: "PUT",
        body: {
          items: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            ...(canOverride && l.override.trim() !== "" ? { unitPriceOverride: Number(enDigits(l.override)) } : {}),
          })),
        },
      });
      toast(fa["common.saved"]);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  const total = lines.reduce((s, l) => s + (l.override.trim() !== "" ? Number(enDigits(l.override)) : l.unitPrice) * l.qty, 0);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {fa["orders.action.editItems"]}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={fa["orders.action.editItems"]}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {fa["common.cancel"]}
            </Button>
            <Button disabled={busy || lines.length === 0} onClick={() => void save()}>
              {fa["common.save"]}
            </Button>
          </>
        }
      >
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.productId} className="border-b border-[var(--line)]">
                <td className="p-1">{l.name}</td>
                <td className="p-1">
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    className="h-7 w-14 text-xs"
                    value={String(l.qty)}
                    onChange={(e) => {
                      const q = Math.max(1, Math.min(50, Number(enDigits(e.target.value)) || 1));
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: q } : x)));
                    }}
                  />
                </td>
                <td className="p-1 text-xs text-[var(--ink-2)]">{formatToman(l.unitPrice)}</td>
                {canOverride ? (
                  <td className="p-1">
                    <Input dir="ltr" inputMode="numeric" className="h-7 w-28 text-xs" placeholder={fa["manual.override"]} value={l.override} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, override: e.target.value } : x)))} />
                  </td>
                ) : null}
                <td className="p-1">
                  <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    {fa["common.remove"]}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between">
          <ProductPicker
            onPick={(p) => {
              if (lines.some((l) => l.productId === p.id)) return;
              setLines((ls) => [...ls, { productId: p.id, name: p.displayName, qty: 1, unitPrice: p.price, override: "" }]);
            }}
          />
          <span className="text-sm">
            {fa["orders.totals.subtotal"]}: {formatToman(total)} · {faInt(lines.length)}
          </span>
        </div>
      </Dialog>
    </>
  );
}
