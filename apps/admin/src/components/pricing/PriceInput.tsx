"use client";
import { useLayoutEffect, useRef } from "react";
import type { InputHTMLAttributes, KeyboardEvent, Ref } from "react";
import { THOUSANDS_SEP } from "@namilux/core/client";
import { cn } from "@/lib/utils";
import { groupDigits, priceDigits } from "@/lib/pricing";

/** Where the caret belongs in a grouped figure so that `digitsBefore` digits sit in front of it. */
function caretAfter(shown: string, digitsBefore: number): number {
  let pos = 0;
  let seen = 0;
  while (pos < shown.length && seen < digitsBefore) {
    if (shown.charAt(pos) !== THOUSANDS_SEP) seen += 1;
    pos += 1;
  }
  return pos;
}

/**
 * A Toman amount that groups itself as it is typed: «۱۲۵۰۰۰۰۰» reads «۱۲٬۵۰۰٬۰۰۰» from the first key,
 * so a missing or an extra zero is seen while the hand is still on the keyboard - not after the save.
 *
 * `value` is bare Latin digits ("12500000"); the grouped Persian figure is only what is drawn.
 * Persian, Arabic and Latin digits are accepted, typed or pasted, with or without separators.
 *
 * The caret is kept by counting the DIGITS in front of it: re-grouping moves the separators, and a
 * caret remembered as a character offset would drift by one every third digit.
 */
export function PriceInput({
  value,
  onDigits,
  className,
  onKeyDown,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode" | "dir"> & {
  value: string;
  onDigits: (digits: string) => void;
  ref?: Ref<HTMLInputElement>;
}) {
  const el = useRef<HTMLInputElement | null>(null);
  /** Digits in front of the caret after the edit being applied; null when no edit is pending. */
  const caret = useRef<number | null>(null);
  const shown = groupDigits(value);

  // No dependency list on purpose: a keystroke that changes nothing (a letter, a second separator)
  // still makes React write the old figure back, and the caret has to be put back with it.
  useLayoutEffect(() => {
    const input = el.current;
    const digitsBefore = caret.current;
    caret.current = null;
    if (input === null || digitsBefore === null || document.activeElement !== input) return;
    const pos = caretAfter(input.value, digitsBefore);
    input.setSelectionRange(pos, pos);
  });

  function keyDown(e: KeyboardEvent<HTMLInputElement>): void {
    const input = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = input;
    // Backspace or Delete landing on a separator would remove nothing a number is made of, and the
    // re-grouping would put the separator straight back: step over it so the digit beyond goes.
    if (start !== null && start === end) {
      if (e.key === "Backspace" && input.value.charAt(start - 1) === THOUSANDS_SEP) input.setSelectionRange(start - 1, start - 1);
      if (e.key === "Delete" && input.value.charAt(start) === THOUSANDS_SEP) input.setSelectionRange(start + 1, start + 1);
    }
    onKeyDown?.(e);
  }

  return (
    <input
      {...props}
      ref={(node) => {
        el.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref !== undefined && ref !== null) ref.current = node;
      }}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      className={cn("ui-input price-input", className)}
      value={shown}
      onKeyDown={keyDown}
      onChange={(e) => {
        const input = e.target;
        const raw = input.value;
        const at = input.selectionStart ?? raw.length;
        const next = priceDigits(raw);
        const digitsBefore = at >= raw.length ? next.length : Math.min(priceDigits(raw.slice(0, at)).length, next.length);
        caret.current = digitsBefore;
        onDigits(next);
        // Nothing changed, so no render follows and the effect above never runs: React still
        // restores the old figure after this handler, and the caret is put back once it has.
        if (next === value) {
          queueMicrotask(() => {
            if (caret.current === null || document.activeElement !== input) return;
            caret.current = null;
            const pos = caretAfter(input.value, digitsBefore);
            input.setSelectionRange(pos, pos);
          });
        }
      }}
    />
  );
}
