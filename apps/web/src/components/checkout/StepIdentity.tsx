"use client";
import { useState } from "react";
import { PhoneOtp } from "@/components/auth/PhoneOtp";
import { t } from "@/i18n";

export function StepIdentity({ onDone }: { onDone: (user: { id: string; firstName: string; lastName: string; phone: string }) => void }): React.ReactNode {
  const [verified, setVerified] = useState<{ customerId: string; phone: string } | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);

  if (verified === null) {
    return <PhoneOtp purpose="checkout" onVerified={(r) => setVerified({ customerId: r.customerId, phone: r.phone })} />;
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/me/profile/", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: first, lastName: last }) });
    } catch {
      /* name is best-effort; proceed to delivery regardless */
    } finally {
      setBusy(false);
    }
    onDone({ id: verified.customerId, firstName: first, lastName: last, phone: verified.phone });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-caption text-ink-2">{t("checkout.name.first")}</span>
          <input className="line-input" value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-caption text-ink-2">{t("checkout.name.last")}</span>
          <input className="line-input" value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="btn btn--primary" disabled={busy}>{t("account.profile.save")}</button>
    </form>
  );
}
