"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Province } from "@namilux/core/client";
import { enDigits, faInt, formatToman, loadProvinces, normalizePhone } from "@namilux/core/client";
import { ProductPicker } from "@/components/products/ProductPicker";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Card, DescList, Field, Input, Select, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";
import { toman } from "@/lib/money";

type Line = { productId: number; name: string; qty: number; unitPrice: number; override: string; overrideReason: string };
type Found = { id: string; name: string | null; phoneMasked: string };

export function ManualOrderForm({ shippingMethods, canOverride, canMarkPaid, payUrlPrefix }: { shippingMethods: { key: string; name: string }[]; canOverride: boolean; canMarkPaid: boolean; payUrlPrefix: string }) {
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<Found | null | undefined>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState<number | null>(null);
  const [discountNote, setDiscountNote] = useState("");
  const [shipping, setShipping] = useState(shippingMethods[0]?.key ?? "");
  const [source, setSource] = useState<"phone" | "instagram" | "whatsapp" | "admin">("phone");
  const [channelRef, setChannelRef] = useState("");
  const [note, setNote] = useState("");
  const [addr, setAddr] = useState({ recipientName: "", recipientPhone: "", province: "", city: "", address: "", postcode: "" });
  const [provinces, setProvinces] = useState<readonly Province[]>([]);
  const [settle, setSettle] = useState<"payment_link" | "mark_paid">("payment_link");
  const [method, setMethod] = useState<"card_to_card" | "cash" | "pos">("card_to_card");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; status: string } | null>(null);

  useEffect(() => {
    void loadProvinces().then(setProvinces).catch(() => toast("فهرست استان‌ها بارگذاری نشد. صفحه را دوباره بارگذاری کنید.", "error"));
  }, []);

  async function lookup(): Promise<void> {
    const n = normalizePhone(phone);
    if (n === null) {
      toast(fa["form.invalid"], "error");
      return;
    }
    setPhone(n);
    try {
      const r = await api<{ items: Found[] }>(`/api/customers?q=${encodeURIComponent(n)}&pageSize=50`);
      setFound(r.items[0] ?? null);
      if (addr.recipientPhone === "") setAddr((a) => ({ ...a, recipientPhone: n }));
    } catch (error) {
      setFound(undefined);
      toast(error instanceof ApiError ? error.message : fa["common.error"], "error");
    }
  }

  const subtotal = lines.reduce((s, l) => s + (l.override.trim() !== "" ? Number(enDigits(l.override)) : l.unitPrice) * l.qty, 0);

  async function submit(): Promise<void> {
    const n = normalizePhone(phone);
    if (n === null || lines.length === 0 || shipping === "") return;
    setBusy(true);
    try {
      const order = await api<{ id: string; code: string }>("/api/orders/manual", {
        method: "POST",
        body: {
          customerId: found?.id ?? null,
          phone: n,
          items: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            ...(canOverride && l.override.trim() !== "" ? { unitPriceOverride: Number(enDigits(l.override)), overrideReason: l.overrideReason } : {}),
          })),
          ...(discount !== null && discount > 0 ? { discount: { amount: discount, note: discountNote } } : {}),
          shippingMethodKey: shipping,
          address: { label: "خانه", ...addr, recipientPhone: enDigits(addr.recipientPhone), postcode: enDigits(addr.postcode), plaque: null, unit: null },
          ...(note.trim() === "" ? {} : { adminNote: note.trim() }),
          source,
          ...(channelRef.trim() === "" ? {} : { channelRef: channelRef.trim() }),
        },
      });
      const done = await api<{ code: string; status: string }>("/api/orders/manual", {
        method: "POST",
        body: { orderId: order.id, submit: settle, ...(settle === "mark_paid" ? { method, reference } : {}) },
      });
      setResult({ code: done.code, status: done.status });
      toast(settle === "payment_link" ? fa["manual.linkSent"] : fa["manual.created"]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  if (result !== null) {
    return (
      <Card>
        <p className="text-sm">
          {fa["manual.created"]}: <Link href={`/orders/${result.code}`} className="ltr font-medium hover:text-[var(--accent)]">{result.code}</Link>
        </p>
        {settle === "payment_link" ? <p className="mt-2 ltr text-xs text-[var(--ink-2)]">{`${payUrlPrefix}${result.code}/`}</p> : null}
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        <Card title={fa["manual.customer"]}>
          <div className="flex items-end gap-2">
            <Field label={fa["manual.phone"]}>
              <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Button variant="outline" onClick={() => void lookup()}>
              {fa["manual.lookup"]}
            </Button>
          </div>
          {found === null ? <p className="mt-2 text-xs text-[var(--ink-2)]">{fa["manual.createCustomer"]}</p> : null}
          {found ? (
            <p className="mt-2 text-sm">
              {found.name ?? fa["common.none"]} · <span className="ltr text-xs">{found.phoneMasked}</span>
            </p>
          ) : null}
        </Card>
        <Card title={fa["manual.items"]}>
          <table className="w-full text-sm">
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.productId} className="border-b border-[var(--line)] align-top">
                  <td className="p-1">{l.name}</td>
                  <td className="p-1">
                    <Input dir="ltr" inputMode="numeric" className="h-8 w-14" value={String(l.qty)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(enDigits(e.target.value)) || 1) } : x)))} />
                  </td>
                  <td className="p-1 text-xs text-[var(--ink-2)]">{formatToman(l.unitPrice)}</td>
                  {canOverride ? (
                    <td className="p-1">
                      <Input dir="ltr" inputMode="numeric" className="h-8 w-28" placeholder={fa["manual.override"]} value={l.override} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, override: e.target.value } : x)))} />
                      {l.override.trim() !== "" ? <Input className="mt-1 h-8 w-40" placeholder={fa["manual.overrideReason"]} value={l.overrideReason} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, overrideReason: e.target.value } : x)))} /> : null}
                    </td>
                  ) : null}
                  <td className="p-1">
                    <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <ProductPicker label={fa["manual.addItem"]} onPick={(p) => { if (!lines.some((l) => l.productId === p.id)) setLines((ls) => [...ls, { productId: p.id, name: p.displayName, qty: 1, unitPrice: p.price, override: "", overrideReason: "" }]); }} />
          </div>
        </Card>
        <Card title={fa["manual.address"]}>
          <div className="grid gap-2 md:grid-cols-2">
            <Field label={fa["manual.recipient"]}>
              <Input value={addr.recipientName} onChange={(e) => setAddr({ ...addr, recipientName: e.target.value })} />
            </Field>
            <Field label={fa["manual.recipientPhone"]}>
              <Input dir="ltr" inputMode="tel" value={addr.recipientPhone} onChange={(e) => setAddr({ ...addr, recipientPhone: e.target.value })} />
            </Field>
            <Field label={fa["manual.province"]}>
              <Select value={addr.province} onChange={(e) => setAddr({ ...addr, province: e.target.value })}>
                <option value="">انتخاب کنید</option>
                {provinces.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={fa["manual.city"]}>
              <Input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
            </Field>
            <Field label={fa["orders.address"]}>
              <Textarea rows={2} value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} />
            </Field>
            <Field label={fa["manual.postcode"]}>
              <Input dir="ltr" inputMode="numeric" value={addr.postcode} onChange={(e) => setAddr({ ...addr, postcode: e.target.value })} />
            </Field>
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <div className="grid gap-4">
            <Field label={fa["manual.shipping"]}>
              <Select value={shipping} onChange={(e) => setShipping(e.target.value)}>
                {shippingMethods.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <MoneyInput label={fa["manual.discount"]} value={discount} onChange={setDiscount} />
            {discount !== null && discount > 0 ? (
              <Field label={fa["manual.discountNote"]}>
                <Input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} maxLength={200} />
              </Field>
            ) : null}
            <Field label={fa["manual.source"]}>
              <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                {(["phone", "instagram", "whatsapp", "admin"] as const).map((s) => (
                  <option key={s} value={s}>
                    {fa[`orders.source.${s}`]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={fa["manual.channelRef"]} hint={fa["manual.channelRef.hint"]}>
              <Input dir="ltr" value={channelRef} onChange={(e) => setChannelRef(e.target.value)} maxLength={120} placeholder="@" />
            </Field>
            <Field label={fa["manual.note"]}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </Field>
          </div>
        </Card>
        <Card>
          <div className="grid gap-4">
            <DescList
              items={[
                { label: fa["orders.totals.subtotal"], value: toman(subtotal) },
                { label: fa["manual.items"], value: faInt(lines.length) },
              ]}
            />
            <Field label={fa["orders.payment"]}>
              <Select value={settle} onChange={(e) => setSettle(e.target.value as "payment_link" | "mark_paid")}>
                <option value="payment_link">{fa["manual.settle.link"]}</option>
                {canMarkPaid ? <option value="mark_paid">{fa["manual.settle.paid"]}</option> : null}
              </Select>
            </Field>
            {settle === "mark_paid" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label={fa["orders.paid.method"]}>
                  <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                    <option value="card_to_card">{fa["orders.paid.card"]}</option>
                    <option value="cash">{fa["orders.paid.cash"]}</option>
                    <option value="pos">{fa["orders.paid.pos"]}</option>
                  </Select>
                </Field>
                <Field label={fa["orders.paid.reference"]}>
                  <Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <Button className="w-full" disabled={busy || lines.length === 0 || normalizePhone(phone) === null || addr.recipientName === "" || addr.province === "" || (settle === "mark_paid" && reference.trim() === "")} onClick={() => void submit()}>
              {fa["orders.new"]}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
