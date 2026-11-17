"use client";
import { enDigits, faDigits } from "@namilux/core/client";
import { useCallback, useRef } from "react";
import { t } from "@/i18n";

const LEN = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  error?: string;
}): React.ReactNode {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const emit = useCallback(
    (next: string): void => {
      const clean = enDigits(next).replace(/\D/g, "").slice(0, LEN);
      onChange(clean);
      if (clean.length === LEN) onComplete(clean);
    },
    [onChange, onComplete],
  );

  const setAt = useCallback(
    (idx: number, raw: string): void => {
      const digit = enDigits(raw).replace(/\D/g, "").slice(-1);
      const chars = value.split("");
      chars[idx] = digit;
      const next = chars.join("").slice(0, LEN);
      emit(next);
      if (digit !== "" && idx < LEN - 1) refs.current[idx + 1]?.focus();
    },
    [value, emit],
  );

  return (
    <div>
      <div className="otp-boxes" dir="ltr" role="group" aria-label={t("checkout.otp.title")}>
        {Array.from({ length: LEN }, (_v, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="otp-box"
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            aria-invalid={error !== undefined}
            value={faDigits(value[i] ?? "")}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && (value[i] ?? "") === "" && i > 0) refs.current[i - 1]?.focus();
            }}
            onPaste={(e) => {
              e.preventDefault();
              emit(e.clipboardData.getData("text"));
              refs.current[Math.min(LEN - 1, enDigits(e.clipboardData.getData("text")).replace(/\D/g, "").length)]?.focus();
            }}
          />
        ))}
      </div>
      {error !== undefined ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
