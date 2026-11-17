"use client";
import type { PowChallenge as Challenge, PowSolution } from "@namilux/integrations/captcha";
import { faDigits } from "@namilux/core/client";
import type { OtpPurpose } from "@namilux/core/client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { t } from "@/i18n";
import { OtpError, useOtp } from "./useOtp";
import { OtpInput } from "./OtpInput";
import { PowChallenge } from "./PowChallenge";

const ERROR_KEY: Record<string, "checkout.otp.wrong" | "checkout.otp.expired" | "checkout.otp.locked" | "checkout.phone.hint"> = {
  OTP_INVALID: "checkout.otp.wrong",
  OTP_EXPIRED: "checkout.otp.expired",
  OTP_LOCKED: "checkout.otp.locked",
  RATE_LIMITED: "checkout.otp.locked",
};

/** An Iranian mobile number as stored: eleven Latin digits starting with 09 (Field folds the display). */
const IR_MOBILE_RE = /^09\d{9}$/;
const PHONE_LENGTH = 11;

function encodePow(sol: PowSolution): string {
  const json = JSON.stringify(sol);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function PhoneOtp({
  purpose,
  initialPhone,
  onVerified,
  compact,
}: {
  purpose: OtpPurpose;
  initialPhone?: string;
  onVerified: (r: { customerId: string; isNew: boolean; phone: string }) => void;
  compact?: boolean;
}): React.ReactNode {
  const { request, verify, busy } = useOtp(purpose);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [resendIn, setResendIn] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [deadlines, setDeadlines] = useState<{ resend: number; expiry: number } | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  useEffect(() => {
    if (deadlines === null || step !== "code") return;
    const tick = (): void => {
      setResendIn(Math.max(0, Math.ceil((deadlines.resend - Date.now()) / 1000)));
      setExpiresIn(Math.max(0, Math.ceil((deadlines.expiry - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlines, step]);

  const mapError = useCallback((e: unknown): string => {
    if (e instanceof OtpError && e.code in ERROR_KEY) return t(ERROR_KEY[e.code] ?? "checkout.otp.wrong");
    if (e instanceof OtpError && e.code === "VALIDATION") return t("checkout.phone.hint");
    // Anything else is the network or the server, not the shopper's code: a fetch that failed on a
    // flaky 4G link used to be reported as «کد درست نیست», which sends people to re-request a code.
    return t("checkout.otp.failed");
  }, []);

  const send = useCallback(
    async (pow?: string): Promise<void> => {
      setError(undefined);
      // Design audit 2 Sep 2026: the CTA stays enabled and the shape is checked on submit with a
      // specific message - a large grey primary read as a broken page.
      if (!IR_MOBILE_RE.test(phone)) {
        setError(t("checkout.phone.invalid"));
        return;
      }
      try {
        const { resendAfterSec, expiresAt, captcha } = await request(phone, pow);
        if (captcha !== null) {
          setChallenge(captcha);
          return;
        }
        setChallenge(null);
        setResendIn(resendAfterSec);
        const expiry = expiresAt === null ? Date.now() : Date.parse(expiresAt);
        setExpiresIn(Math.max(0, Math.ceil((expiry - Date.now()) / 1000)));
        setDeadlines({ resend: Date.now() + resendAfterSec * 1000, expiry });
        setCode("");
        setStep("code");
      } catch (e) {
        setChallenge(null);
        setError(mapError(e));
      }
    },
    [phone, request, mapError],
  );

  const onSolved = useCallback(
    (sol: PowSolution): void => {
      void send(encodePow(sol));
    },
    [send],
  );

  const submitCode = useCallback(
    async (full: string): Promise<void> => {
      setError(undefined);
      try {
        const r = await verify(phone, full);
        onVerified({ ...r, phone });
      } catch (e) {
        setCode("");
        setError(mapError(e));
      }
    },
    [phone, verify, onVerified, mapError],
  );

  if (step === "phone") {
    return (
      <div className={compact ? "phone-otp phone-otp--compact" : "phone-otp"}>
        <Field
          name="phone"
          label="checkout.phone"
          type="tel"
          inputMode="numeric"
          digits="fa"
          hint="checkout.phone.hint"
          autoComplete="tel"
          maxLength={PHONE_LENGTH}
          placeholder={t("checkout.phone.placeholder")}
          value={phone}
          onChange={(v) => {
            setPhone(v);
            if (error !== undefined) setError(undefined);
          }}
          {...(error !== undefined ? { error } : {})}
        />
        {challenge !== null ? (
          <PowChallenge challenge={challenge} onSolved={onSolved} />
        ) : (
          <Button variant="primary" block arrow loading={busy} onClick={() => void send()}>
            {t("checkout.otp.send")}
          </Button>
        )}
        {/* Baymard checkout 2025: say what the number is for - no password, and the order's SMS updates. */}
        <p className="phone-otp__why">{t("checkout.phone.why")}</p>
      </div>
    );
  }

  return (
    <div className={compact ? "phone-otp phone-otp--compact" : "phone-otp"}>
      <p className="phone-otp__sent">{t("checkout.otp.sentTo", { phone: faDigits(phone) })}</p>
      <p className="phone-otp__expiry">
        {expiresIn > 0 ? t("checkout.otp.validFor") : t("checkout.otp.expired")}
        {expiresIn > 0 ? <bdi>{faDigits(`${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`)}</bdi> : null}
      </p>
      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={(c) => void submitCode(c)}
        disabled={busy}
        {...(error !== undefined ? { error } : {})}
      />
      <div className="phone-otp__actions">
        {challenge !== null ? <PowChallenge challenge={challenge} onSolved={onSolved} /> : null}
        {resendIn > 0 ? (
          <span className="phone-otp__timer">{t("checkout.otp.resendIn", { s: resendIn })}</span>
        ) : (
          <Button variant="quiet" loading={busy} onClick={() => void send()}>
            {t("checkout.otp.resend")}
          </Button>
        )}
        <Button
          variant="quiet"
          onClick={() => {
            setStep("phone");
            setCode("");
            setError(undefined);
          }}
        >
          {t("checkout.otp.change")}
        </Button>
      </div>
    </div>
  );
}
