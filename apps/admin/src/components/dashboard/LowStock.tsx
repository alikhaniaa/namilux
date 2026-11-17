"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt } from "@namilux/core/client";
import { Button, Card, EmptyState, Input } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function LowStock({ items }: { items: { productId: number; displayName: string; available: number }[] }) {
  const router = useRouter();
  const [delta, setDelta] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function adjust(id: number): Promise<void> {
    const n = Number(delta[id] ?? "");
    if (!Number.isInteger(n) || n === 0) return;
    setBusy(id);
    try {
      await api(`/api/products/${String(id)}/stock`, { method: "PUT", body: { delta: n, reason: "restock", note: "dashboard" } });
      toast(fa["common.saved"]);
      setDelta((d) => ({ ...d, [id]: "" }));
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={fa["dash.lowStock"]}
      description={fa["dash.lowStock.hint"]}
      actions={
        <Link href="/products?stockState=low" className="ui-link-btn">
          {fa["dash.viewAll"]}
        </Link>
      }
    >
      {items.length === 0 ? (
        <EmptyState text={fa["dash.lowStock.empty"]} />
      ) : (
        <ul className="stock-list">
          {items.slice(0, 8).map((p) => (
            // Design audit 2 Sep 2026: on a phone the row is a 44 px link into the product (its stock
            // tab has the real form); the inline «+ / اعمال» pair is a desktop convenience only.
            <li key={p.productId}>
              <Link href={`/products/${String(p.productId)}`} className="stock-list__name">
                {p.displayName}
              </Link>
              <span className={p.available <= 0 ? "stock-pill stock-pill--out" : "stock-pill"}>{p.available <= 0 ? fa["dash.stock.out"] : fa["dash.stock.left"].replace("{n}", faInt(p.available))}</span>
              <span className="stock-list__restock">
                <Input dir="ltr" className="stock-list__qty" placeholder="+۵" aria-label={fa["products.stock"]} value={delta[p.productId] ?? ""} onChange={(e) => setDelta((d) => ({ ...d, [p.productId]: e.target.value }))} />
                <Button size="sm" variant="outline" busy={busy === p.productId} onClick={() => void adjust(p.productId)}>
                  {fa["common.apply"]}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
