"use client";

import { enDigits, faDigits } from "@namilux/core/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fa } from "@/i18n/fa";
import { api, ApiError } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/kit";
import { safeNext } from "@/lib/safe-next";

export default function TotpPage() {
  const router = useRouter();
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [enrol, setEnrol] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem("nl_temp");
    if (t === null) {
      router.replace("/login");
      return;
    }
    setTempToken(t);
    const needEnrol = sessionStorage.getItem("nl_enrol") === "1";
    setEnrol(needEnrol);
    if (needEnrol) {
      api<{ otpauthUri: string; secret: string }>(`/api/auth/totp?enrol=1&tempToken=${encodeURIComponent(t)}`)
        .then((d) => {
          setOtpauth(d.otpauthUri);
          setSecret(d.secret);
        })
        .catch((e: unknown) => setError(e instanceof ApiError ? e.message : fa["common.error"]));
    }
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tempToken === null) return;
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/totp", { method: "POST", body: { tempToken, code, enrol } });
      // The page the staff member originally asked for, re-validated here (never a bare trust of storage).
      const next = safeNext(sessionStorage.getItem("nl_next"));
      sessionStorage.removeItem("nl_temp");
      sessionStorage.removeItem("nl_enrol");
      sessionStorage.removeItem("nl_next");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fa["common.error"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-intro" aria-hidden="true">
        <span className="brand-logo" />
        <div>
          <p className="auth-intro__eyebrow">مدیریت فروشگاه نامی‌لوکس</p>
          <h1>{fa["shell.workspace"]}</h1>
          <p>{fa["auth.workspaceIntro"]}</p>
        </div>
        <p className="auth-intro__foot">namilux.ir</p>
      </section>
      <section className="auth-pane">
        <form onSubmit={submit} className="auth-card" noValidate>
          <span className="brand-logo auth-card__brand" role="img" aria-label={fa["app.name"]} />
          <h1>{enrol ? fa["auth.enrol.title"] : fa["auth.totp"]}</h1>
          {enrol ? (
            <div className="grid gap-2 text-sm">
              <p className="auth-card__lead">{fa["auth.enrol.body"]}</p>
              {secret !== null ? <p className="auth-secret">{secret}</p> : null}
              {otpauth !== null ? (
                <a className="auth-secret text-accent" href={otpauth}>
                  باز کردن برنامهٔ تأیید دومرحله‌ای
                </a>
              ) : null}
            </div>
          ) : null}
          <Field label={fa["auth.totp"]} hint={fa["auth.totp.hint"]}>
            <Input inputMode="numeric" dir="ltr" autoComplete="one-time-code" maxLength={6} value={faDigits(code)} onChange={(e) => setCode(enDigits(e.target.value).replace(/\D/g, ""))} required autoFocus />
          </Field>
          {error !== null ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? fa["common.loading"] : fa["sudo.confirm"]}
          </Button>
        </form>
      </section>
    </main>
  );
}
