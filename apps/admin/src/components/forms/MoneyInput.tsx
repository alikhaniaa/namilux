"use client";
import { faInt } from "@namilux/core/client";
import { useId, useState } from "react";
import { Field, Input } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { TOMAN, parseTomanInput } from "@/lib/money";

/**
 * A whole-Toman amount. Unfocused it shows the grouped Persian figure («۱۲٬۵۰۰٬۰۰۰»); focused it
 * shows the raw digits for editing, with the grouped value read back underneath so a missing or
 * extra zero is visible while typing. Persian/Arabic digits and pasted separators are accepted;
 * anything beyond the core's MAX_TOMAN is refused rather than silently rounded by JS.
 */
export function MoneyInput({ value, onChange, label: rawLabel, error, hint, disabled = false }: { value: number | null; onChange: (v: number | null) => void; label: string; error?: string; hint?: string; disabled?: boolean }) {
  // the unit box beside the field already says «تومان», so a label's own «(تومان)» is dropped
  const label = rawLabel.replace(/\s*\(تومان\)\s*$/u, "");
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value === null ? "" : String(value));
  const [local, setLocal] = useState("");
  const unitId = useId();
  const shown = focused || local !== "" ? text : value === null ? "" : faInt(value);
  const shownError = local !== "" ? local : error;
  return (
    <Field label={label} {...(shownError === undefined ? {} : { error: shownError })} {...(hint === undefined ? {} : { hint })}>
      <span className="ui-money">
        <Input
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          aria-invalid={shownError !== undefined && shownError !== ""}
          aria-describedby={unitId}
          disabled={disabled}
          value={shown}
          onFocus={() => {
            if (local === "") setText(value === null ? "" : String(value));
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          onChange={(e) => {
            const parsed = parseTomanInput(e.target.value);
            if (parsed !== null && Number.isNaN(parsed)) {
              // keep what was typed on screen, report it, and leave the form's value alone
              setText(e.target.value);
              setLocal(fa["money.invalid"]);
              e.target.setCustomValidity(fa["money.invalid"]);
              return;
            }
            setLocal("");
            e.target.setCustomValidity("");
            setText(parsed === null ? "" : String(parsed));
            onChange(parsed);
          }}
        />
        <span id={unitId} className="ui-money__unit">
          {TOMAN}
        </span>
      </span>
      {value !== null && value > 0 && local === "" ? <span className="ui-money__readout">{fa["money.readout"].replace("{v}", faInt(value))}</span> : null}
    </Field>
  );
}
