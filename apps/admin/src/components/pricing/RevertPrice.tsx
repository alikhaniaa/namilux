"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { ApiError } from "@/lib/api-client";
import { conflictIds, patchPrices } from "@/lib/price-save";
import { PRICE_NOTES } from "@/lib/pricing";
import type { Prices } from "@/lib/pricing";

/**
 * Puts one logged change back: the product returns to the price it had before that change. Offered
 * only on a product's latest change, and refused by the server if the price has moved since.
 */
export function RevertPrice({ productId, name, current, previous }: { productId: number; name: string; current: Prices; previous: Prices }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(): Promise<void> {
    setBusy(true);
    try {
      await patchPrices([{ id: productId, before: current, after: previous }], PRICE_NOTES.undo);
      toast(`قیمت «${name}» به مقدار قبلی برگشت.`);
    } catch (e) {
      toast(conflictIds(e) !== null ? "قیمت این کالا بعد از این تغییر دوباره عوض شده است؛ فهرست تازه شد." : e instanceof ApiError ? e.message : "انجام نشد. اتصال را بررسی کنید.", "error");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <Button size="sm" variant="ghost" busy={busy} icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => void run()} aria-label={`برگرداندن قیمت ${name}`}>
      برگرداندن
    </Button>
  );
}
