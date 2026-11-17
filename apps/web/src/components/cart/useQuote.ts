"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, Quote, QuoteAddressRef, QuoteLine } from "@namilux/core/client";
import { cartStore, useCart } from "@/components/state/cart-store";

type Opts = { couponCode?: string; usePoints?: boolean; shippingKey?: string; addressRef?: QuoteAddressRef };
type Envelope = { ok: true; data: Quote } | { ok: false; error: { code: ErrorCode } };

/**
 * Reasons that mean the shop took the product off sale (deleted, disabled/draft, hidden, switched to
 * «استعلامی»). Those lines leave the basket by themselves; out-of-stock ones stay listed as
 * unavailable, because the shopper may wait for a restock (4 Oct 2026, owner's report).
 */
const OFF_SALE = new Set(["archived", "hidden", "on_request"]);

export function useQuote(opts: Opts): { quote: Quote | null; loading: boolean; error: ErrorCode | null; removed: QuoteLine[]; dropped: string[]; refresh: () => void } {
  const { lines } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const key = JSON.stringify([lines.map((l) => [l.id, l.qty]), opts.couponCode ?? "", opts.usePoints ?? false, opts.shippingKey ?? "", opts.addressRef ?? null]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    if (lines.length === 0) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/quote/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          lines: lines.map((l) => ({ productId: l.id, qty: l.qty })),
          ...(opts.couponCode !== undefined && opts.couponCode !== "" ? { couponCode: opts.couponCode } : {}),
          ...(opts.usePoints === true ? { usePoints: true } : {}),
          ...(opts.shippingKey !== undefined ? { shippingKey: opts.shippingKey } : {}),
          ...(opts.addressRef !== undefined ? { addressId: opts.addressRef } : {}),
        }),
      });
      const body = (await res.json()) as Envelope;
      if (body.ok) {
        setQuote(body.data);
        for (const line of body.data.lines) {
          if (line.status === "qty_reduced") cartStore.setQty(line.productId, line.qty);
        }
        const offSale = new Set(body.data.warnings.flatMap((w) => (w.kind === "removed" && OFF_SALE.has(w.reason) ? [w.productId] : [])));
        if (offSale.size > 0) {
          const names = body.data.lines.filter((l) => offSale.has(l.productId) && l.name !== "").map((l) => l.name);
          setDropped((prev) => [...prev, ...names.filter((n) => !prev.includes(n))]);
          for (const id of offSale) cartStore.remove(id);
        }
      } else {
        setError(body.error.code);
      }
    } catch {
      if (!ac.signal.aborted) setError("INTERNAL");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }  }, [key]);

  useEffect(() => {
    const t = setTimeout(() => void run(), 400);
    return () => clearTimeout(t);
  }, [key, run]);

  const gone = new Set((quote?.warnings ?? []).flatMap((w) => (w.kind === "removed" && OFF_SALE.has(w.reason) ? [w.productId] : [])));
  const removed = quote?.lines.filter((l) => l.status === "removed" && !gone.has(l.productId)) ?? [];
  return { quote, loading, error, removed, dropped, refresh: () => void run() };
}
