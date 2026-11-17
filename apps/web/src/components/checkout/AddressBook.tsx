"use client";
import type { Address } from "@namilux/core/client";
import { t } from "@/i18n";
import { Bdi } from "@/components/ui/Bdi";
import { AddressForm } from "./AddressForm";
import type { AddressDraft, DraftError } from "./pay-sequence";

/**
 * The saved addresses and, under them, the new-address form.
 *
 * Which of the two the order ships to is decided by what is OPEN: while the form is on screen its
 * text is the address (the pay button saves it), and picking a saved address closes the form. The
 * draft itself is kept by the parent, so closing it never loses what was typed.
 */
export function AddressBook({ addresses, selectedId, onSelect, adding, onAdding, draft, onDraftChange, onSave, error }: {
  addresses: Address[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  adding: boolean;
  onAdding: (open: boolean) => void;
  draft: AddressDraft;
  onDraftChange: (next: AddressDraft) => void;
  onSave: (draft: AddressDraft) => Promise<void>;
  error?: DraftError | null;
}): React.ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="t-body text-ink">{t("checkout.address.title")}</h3>
      {addresses.map((a) => (
        <label key={a.id} className={`opt-card${!adding && selectedId === a.id ? " is-selected" : ""}`}>
          <input
            type="radio"
            name="address"
            checked={!adding && selectedId === a.id}
            // Choosing a saved address is also how the shopper abandons a half-typed new one: the
            // form closes so the button can never mean two addresses at once.
            onChange={() => {
              onSelect(a.id);
              onAdding(false);
            }}
          />
          <span className="flex flex-col">
            <Bdi text={`${a.recipientName}، ${a.city}`} className="t-body text-ink" />
            <Bdi text={a.address} className="t-caption text-ink-2" />
          </span>
        </label>
      ))}
      {adding ? (
        <AddressForm
          value={draft}
          onChange={onDraftChange}
          onSave={onSave}
          submitLabel="checkout.address.save"
          hint="checkout.address.autosave"
          error={error ?? null}
        />
      ) : (
        <>
          <button type="button" className="link-under t-caption self-start" onClick={() => onAdding(true)}>{t("checkout.address.new")}</button>
          {error !== undefined && error !== null ? <p className="t-caption text-danger" role="alert">{t(error.messageKey)}</p> : null}
        </>
      )}
    </div>
  );
}
