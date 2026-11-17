"use client";
import type { Customer } from "@namilux/core/client";
import { phoneDisplay } from "@namilux/core/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/components/state/toast-store";
import { t } from "@/i18n";

export function ProfileForm({ customer }: { customer: Customer }): React.ReactNode {
  const router = useRouter();
  const [firstName, setFirstName] = useState(customer.firstName ?? "");
  const [lastName, setLastName] = useState(customer.lastName ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [birthday, setBirthday] = useState(customer.birthday ?? "");
  const [marketingOptIn, setMarketingOptIn] = useState(customer.marketingOptIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/me/profile/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email: email.trim() === "" ? null : email.trim(),
          birthday: birthday === "" ? null : birthday,
          marketingOptIn,
        }),
      });
      if (res.ok) {
        toast.show({ key: "account.profile.saved" });
        router.refresh();
      }
      else setError(t("checkout.error.generic"));
    } catch {
      setError(t("checkout.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="profile-form__phone">
        {t("checkout.phone")}: <bdi>{phoneDisplay(customer.phone)}</bdi>
      </p>
      <Field name="firstName" label="checkout.name.first" value={firstName} onChange={setFirstName} required autoComplete="given-name" />
      <Field name="lastName" label="checkout.name.last" value={lastName} onChange={setLastName} required autoComplete="family-name" />
      <Field name="email" label="checkout.email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field name="birthday" label="account.profile.birthday" type="text" inputMode="numeric" value={birthday} onChange={setBirthday} />
      <label className="profile-form__opt">
        <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
        <span>{t("account.profile.marketing")}</span>
      </label>
      {error !== undefined ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="primary" type="submit" loading={busy}>
        {t("account.profile.save")}
      </Button>
    </form>
  );
}
