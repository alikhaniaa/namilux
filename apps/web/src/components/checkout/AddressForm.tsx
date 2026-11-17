"use client";
import { useEffect, useState } from "react";
import { loadProvinces } from "@namilux/core/client";
import type { ProvinceCode } from "@namilux/core/client";
import type { FaKey } from "@/i18n";
import { t } from "@/i18n";
import type { AddressDraft, DraftError } from "./pay-sequence";

/**
 * The checkout's new-address form.
 *
 * DECISION: controlled from the outside. The pay button may have to save this form itself, so the
 * values cannot live in here â€” a parent that only learns them on submit would be reading yesterday's
 * text. Nothing is reset on failure either: the draft is the parent's state and survives every
 * error, so a corrected field is one keystroke away rather than a retyped form.
 */
export function AddressForm({ value, onChange, onSave, submitLabel, error, hint }: {
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
  /** The optional explicit save. Absent, the form is only a draft the pay button will save. */
  onSave?: (draft: AddressDraft) => Promise<void>;
  submitLabel: FaKey;
  error?: DraftError | null;
  hint?: FaKey;
}): React.ReactNode {
  const [provinces, setProvinces] = useState<{ code: ProvinceCode; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void loadProvinces().then((ps) => {
      if (alive) setProvinces(ps.map((p) => ({ code: p.code, name: p.name })));
    });
    return () => {
      alive = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof AddressDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value });

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (onSave === undefined || busy) return;
    setBusy(true);
    try {
      await onSave(value);
    } finally {
      setBusy(false);
    }
  };

  const input = (name: keyof AddressDraft, label: FaKey, type = "text"): React.ReactNode => (
    <label className="flex flex-col gap-1">
      <span className="t-caption text-ink-2">{t(label)}</span>
      <input
        className="line-input"
        type={type}
        name={name}
        autoComplete={name === "recipientFirstName" ? "given-name" : name === "recipientLastName" ? "family-name" : undefined}
        value={value[name]}
        onChange={set(name)}
        aria-invalid={error?.field === name ? true : undefined}
        required={name === "recipientFirstName" || name === "recipientLastName" || name === "recipientPhone" || name === "city" || name === "address" || name === "postcode"}
      />
    </label>
  );

  return (
    // noValidate: the browser's own bubbles are English and cover our Persian sentences; every
    // field is checked again in validateDraft() and once more on the server.
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {input("recipientFirstName", "checkout.address.firstName")}
        {input("recipientLastName", "checkout.address.lastName")}
      </div>
      {input("recipientPhone", "checkout.address.recipientPhone", "tel")}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-caption text-ink-2">{t("checkout.address.province")}</span>
          <select className="line-input" value={value.province} onChange={set("province")}>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </select>
        </label>
        {input("city", "checkout.address.city")}
      </div>
      {input("address", "checkout.address.address")}
      <div className="grid grid-cols-3 gap-3">
        {input("plaque", "checkout.address.plaque")}
        {input("unit", "checkout.address.unit")}
        {input("postcode", "checkout.address.postcode", "tel")}
      </div>
      {hint !== undefined ? <p className="t-caption text-ink-2">{t(hint)}</p> : null}
      {error !== undefined && error !== null ? <p className="t-caption text-danger" role="alert">{t(error.messageKey)}</p> : null}
      {onSave !== undefined ? (
        <button type="submit" className="btn btn--secondary self-start" disabled={busy}>{t(submitLabel)}</button>
      ) : null}
    </form>
  );
}
