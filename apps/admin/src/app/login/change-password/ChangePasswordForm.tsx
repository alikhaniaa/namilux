"use client";
import { PasswordInput } from "@/components/forms/PasswordInput";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fa } from "@/i18n/fa";
import { api, ApiError } from "@/lib/api-client";
import { Button, Field } from "@/components/kit";

/**
 * Changing the password ends every session of that staff member, but the route opens a fresh one
 * for this browser and sets its cookie on the response - so the ending is the panel, not the login
 * screen. `router.refresh()` first, to drop the server-rendered tree this page was built with
 * (`must_change_password` was still true in it), then the dashboard.
 */
export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (next !== repeat) {
      setError(fa["account.password.mismatch"]);
      return;
    }
    setBusy(true);
    try {
      await api("/api/account/password", { method: "POST", body: { current, next } });
      setDone(true);
      setCurrent("");
      setNext("");
      setRepeat("");
      router.refresh();
      router.replace("/");
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
        <form onSubmit={(e) => void submit(e)} className="auth-card" noValidate>
          <span className="brand-logo auth-card__brand" role="img" aria-label={fa["app.name"]} />
          <h1>{fa["account.password"]}</h1>
          <p className="auth-card__lead">{forced ? fa["auth.mustChange.body"] : fa["account.password.body"]}</p>
          <Field label={fa["account.password.current"]}>
            <PasswordInput dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label={fa["account.password.next"]} hint={fa["account.password.rule"]}>
            <PasswordInput dir="ltr" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label={fa["account.password.repeat"]}>
            <PasswordInput dir="ltr" autoComplete="new-password" minLength={12} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </Field>
          {error !== null ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {done ? (
            <p className="text-sm text-[var(--ok)]" role="status">
              {fa["auth.mustChange.done"]}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || done}>
            {busy ? fa["common.loading"] : fa["common.save"]}
          </Button>
        </form>
      </section>
    </main>
  );
}
