"use client";
import { PasswordInput } from "@/components/forms/PasswordInput";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fa } from "@/i18n/fa";
import { api, ApiError } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/kit";
import { safeNext } from "@/lib/safe-next";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    try {
      const result = await api<{ authenticated: true } | { authenticated?: false; needsTotp: boolean; tempToken: string }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (result.authenticated === true) {
        sessionStorage.removeItem("nl_temp");
        sessionStorage.removeItem("nl_enrol");
        sessionStorage.removeItem("nl_next");
        router.replace(next);
        router.refresh();
        return;
      }
      const { needsTotp, tempToken } = result;
      sessionStorage.setItem("nl_temp", tempToken);
      sessionStorage.setItem("nl_enrol", needsTotp ? "0" : "1");
      sessionStorage.setItem("nl_next", next);
      router.push("/login/totp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fa["auth.failed"]);
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
          <h1>{fa["auth.login"]}</h1>
          <p className="auth-card__lead">{fa["auth.secureAccess"]}</p>
          <Field label={fa["auth.email"]}>
            <Input type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label={fa["auth.password"]}>
            <PasswordInput dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error !== null ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? fa["common.loading"] : fa["auth.login"]}
          </Button>
        </form>
      </section>
    </main>
  );
}
