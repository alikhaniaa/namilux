"use client";
import Image from "next/image";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export type PaymentMethodKey = "zarinpal" | "snapppay";
export type PaymentMethodOption = { key: PaymentMethodKey; disabled?: boolean; note?: string; title?: string };

const LABEL: Record<PaymentMethodKey, FaKey> = { zarinpal: "checkout.payment.zarinpal", snapppay: "checkout.payment.snapppay" };
const DESC: Record<PaymentMethodKey, FaKey | null> = { zarinpal: "checkout.payment.zarinpal.desc", snapppay: null };
const LOGO: Partial<Record<PaymentMethodKey, { src: string; alt: string }>> = {
  snapppay: { src: "/brand/payments-20261003/snapppay.png", alt: "اسنپ‌پی" },
};

/**
 * Card payment, plus SnappPay when its /eligible said yes. A SnappPay row carries the gateway's own
 * title (line one) and description (line two) verbatim - their display rule - so it has no local
 * description to fall back on; StepDelivery does not offer the row without them.
 */
export function PaymentMethods({ methods, value, onChange }: { methods: PaymentMethodOption[]; value: string; onChange: (v: PaymentMethodKey) => void }): React.ReactNode {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="t-body text-ink mb-2">{t("checkout.payment.title")}</legend>
      {methods.map((m) => {
        const disabled = m.disabled === true;
        const desc = m.note !== undefined && m.note !== "" ? m.note : DESC[m.key] !== null ? t(DESC[m.key] as FaKey) : "";
        const logo = LOGO[m.key];
        return (
          <label key={m.key} className={`opt-card items-center${value === m.key ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>
            <input type="radio" name="payment" value={m.key} checked={value === m.key} disabled={disabled} onChange={() => onChange(m.key)} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="t-body text-ink">{m.title ?? t(LABEL[m.key])}</span>
              {desc !== "" ? <span className="t-caption text-ink-2">{desc}</span> : null}
            </span>
            {logo !== undefined ? (
              <Image src={logo.src} alt={logo.alt} width={56} height={48} className="h-12 w-14 shrink-0 bg-plate-chip object-contain p-1" unoptimized />
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}
