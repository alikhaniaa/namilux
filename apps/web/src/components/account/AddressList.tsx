"use client";
import type { Address, Province } from "@namilux/core/client";
import { loadProvinces } from "@namilux/core/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";
import { AccountEmpty } from "./AccountEmpty";

type Draft = {
  label: string;
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  address: string;
  plaque: string;
  unit: string;
  postcode: string;
  isDefault: boolean;
};

const EMPTY: Draft = {
  label: "خانه",
  recipientName: "",
  recipientPhone: "",
  // DECISION: Tehran preselected like checkout/AddressForm - a native <select> without a placeholder
  // would otherwise show the first province while the draft still holds "" and the city stays disabled.
  province: "THR",
  city: "",
  address: "",
  plaque: "",
  unit: "",
  postcode: "",
  isDefault: false,
};

function toDraft(a: Address): Draft {
  return {
    label: a.label,
    recipientName: a.recipientName,
    recipientPhone: a.recipientPhone,
    province: a.province,
    city: a.city,
    address: a.address,
    plaque: a.plaque ?? "",
    unit: a.unit ?? "",
    postcode: a.postcode,
    isDefault: a.isDefault,
  };
}

export function AddressList({ addresses }: { addresses: Address[] }): React.ReactNode {
  const router = useRouter();
  const [provinces, setProvinces] = useState<readonly Province[]>([]);
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const [action, setAction] = useState<{ id: string; kind: "delete" | "default" } | null>(null);
  const actionPending = useRef(false);

  useEffect(() => {
    void loadProvinces().then(setProvinces);
  }, []);

  const openNew = (): void => {
    setDraft(EMPTY);
    setError(undefined);
    setEditing("new");
  };
  const openEdit = (a: Address): void => {
    setDraft(toDraft(a));
    setError(undefined);
    setEditing(a);
  };

  const refresh = (): void => router.refresh();

  const changeAddress = async (id: string, kind: "delete" | "default"): Promise<void> => {
    if (actionPending.current) return;
    actionPending.current = true;
    setAction({ id, kind });
    setListError(undefined);
    try {
      const res = await fetch(`/api/me/addresses/${id}/`, kind === "delete" ? { method: "DELETE" } : {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) refresh();
      else setListError(t("checkout.error.generic"));
    } catch {
      setListError(t("checkout.error.generic"));
    } finally {
      actionPending.current = false;
      setAction(null);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const body = {
      label: draft.label,
      recipientName: draft.recipientName,
      recipientPhone: draft.recipientPhone,
      province: draft.province,
      city: draft.city,
      address: draft.address,
      plaque: draft.plaque === "" ? undefined : draft.plaque,
      unit: draft.unit === "" ? undefined : draft.unit,
      postcode: draft.postcode,
      isDefault: draft.isDefault,
    };
    const url = editing === "new" ? "/api/me/addresses/" : `/api/me/addresses/${(editing as Address).id}/`;
    try {
      const res = await fetch(url, {
        method: editing === "new" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditing(null);
        refresh();
      } else {
        const env = (await res.json()) as { error?: { message?: string } };
        setError(env.error?.message ?? t("checkout.error.generic"));
      }
    } catch {
      setError(t("checkout.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const cities = provinces.find((p) => p.code === draft.province)?.cities ?? [];

  return (
    <div className="address-list">
      <Button variant="secondary" icon="plus" disabled={action !== null} onClick={openNew}>
        {t("checkout.address.new")}
      </Button>
      {listError === undefined ? null : <p className="field-error" role="alert">{listError}</p>}

      {addresses.length === 0 ? (
        <AccountEmpty icon="location" title="account.addresses.empty" body="account.addresses.hint" shop={false} />
      ) : (
        <ul className="address-list__items">
          {addresses.map((a) => (
            <li key={a.id} className="address-card">
              <div className="address-card__head">
                <span className="address-card__label">{a.label}</span>
                {a.isDefault ? <span className="badge">{t("account.addresses.default")}</span> : null}
              </div>
              <p className="address-card__who">
                {a.recipientName}، <bdi>{a.recipientPhone}</bdi>
              </p>
              <p className="address-card__body">
                {a.province} · {a.city} · {a.address}
                {a.plaque !== null ? ` · ${a.plaque}` : ""}
              </p>
              <div className="address-card__actions">
                <Button variant="quiet" disabled={action !== null} onClick={() => openEdit(a)}>
                  {t("account.addresses.edit")}
                </Button>
                {!a.isDefault ? (
                  <Button variant="quiet" disabled={action !== null} loading={action?.id === a.id && action.kind === "default"} onClick={() => void changeAddress(a.id, "default")}>
                    {t("account.addresses.setDefault")}
                  </Button>
                ) : null}
                <Button variant="quiet" disabled={action !== null} loading={action?.id === a.id && action.kind === "delete"} onClick={() => void changeAddress(a.id, "delete")}>
                  {t("account.addresses.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("checkout.address.title")}
        footer={
          <Button variant="primary" block loading={busy} onClick={() => void save()}>
            {t("account.profile.save")}
          </Button>
        }
      >
        <div className="address-form">
          <Field name="label" label="checkout.address.label" value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
          <Field name="recipientName" label="checkout.address.recipient" value={draft.recipientName} onChange={(v) => setDraft({ ...draft, recipientName: v })} required />
          <Field name="recipientPhone" label="checkout.address.recipientPhone" type="tel" inputMode="numeric" digits="fa" value={draft.recipientPhone} onChange={(v) => setDraft({ ...draft, recipientPhone: v })} required />
          <Select
            name="province"
            label="checkout.address.province"
            value={draft.province}
            options={provinces.map((p) => ({ value: p.code, label: p.name }))}
            onChange={(v) => setDraft({ ...draft, province: v, city: "" })}
          />
          <Select
            name="city"
            label="checkout.address.city"
            value={draft.city}
            options={cities.map((c) => ({ value: c, label: c }))}
            placeholder="form.select"
            onChange={(v) => setDraft({ ...draft, city: v })}
            disabled={draft.province === ""}
          />
          <Textarea name="address" label="checkout.address.address" value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} />
          <Field name="plaque" label="checkout.address.plaque" value={draft.plaque} onChange={(v) => setDraft({ ...draft, plaque: v })} />
          <Field name="unit" label="checkout.address.unit" value={draft.unit} onChange={(v) => setDraft({ ...draft, unit: v })} />
          <Field name="postcode" label="checkout.address.postcode" inputMode="numeric" digits="fa" maxLength={10} value={draft.postcode} onChange={(v) => setDraft({ ...draft, postcode: v })} required />
          <label className="address-form__default">
            <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
            <span>{t("account.addresses.setDefault")}</span>
          </label>
          {error !== undefined ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
