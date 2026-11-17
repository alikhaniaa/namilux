"use client";
import type { PowChallenge } from "@namilux/integrations/captcha";
import type { OtpPurpose } from "@namilux/core/client";
import { useCallback, useState } from "react";

export class OtpError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OtpError";
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const env = (await res.json()) as Envelope<T>;
  if (!env.ok) throw new OtpError(env.error.code);
  return env.data;
}

export function useOtp(purpose: OtpPurpose): {
  request: (phone: string, pow?: string) => Promise<{ resendAfterSec: number; expiresAt: string | null; captcha: PowChallenge | null }>;
  verify: (phone: string, code: string) => Promise<{ customerId: string; isNew: boolean }>;
  busy: boolean;
} {
  const [busy, setBusy] = useState(false);

  const request = useCallback(
    async (phone: string, pow?: string) => {
      setBusy(true);
      try {
        const data = await post<{ resendAfterSec: number; expiresAt: string | null; captchaRequired: boolean; challenge?: PowChallenge }>(
          "/api/auth/otp/request/",
          { phone, purpose, ...(pow !== undefined ? { powToken: pow } : {}) },
        );
        return { resendAfterSec: data.resendAfterSec, expiresAt: data.expiresAt, captcha: data.challenge ?? null };
      } finally {
        setBusy(false);
      }
    },
    [purpose],
  );

  const verify = useCallback(
    async (phone: string, code: string) => {
      setBusy(true);
      try {
        const data = await post<{ customerId: string; firstName: string | null }>("/api/auth/otp/verify/", {
          phone,
          code,
          purpose,
        });
        return { customerId: data.customerId, isNew: false };
      } finally {
        setBusy(false);
      }
    },
    [purpose],
  );

  return { request, verify, busy };
}
