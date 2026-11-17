"use client";
import type { PowChallenge as Challenge, PowSolution } from "@namilux/integrations/captcha";
import { useEffect } from "react";
import { t } from "@/i18n";

function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function PowChallenge({
  challenge,
  onSolved,
}: {
  challenge: Challenge;
  onSolved: (s: PowSolution) => void;
}): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let nonce = 0;
      const cap = 1 << Math.min(challenge.bits + 8, 30);
      while (nonce < cap && !cancelled) {
        const bytes = new TextEncoder().encode(`${challenge.salt}${nonce}`);
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        if (leadingZeroBits(hash) >= challenge.bits) break;
        nonce += 1;
      }
      if (!cancelled) {
        onSolved({
          salt: challenge.salt,
          nonce,
          bits: challenge.bits,
          expiresAt: challenge.expiresAt,
          sig: challenge.sig,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [challenge, onSolved]);

  return (
    <p className="pow-note" role="status" aria-live="polite">
      {t("checkout.otp.captcha")}
    </p>
  );
}
