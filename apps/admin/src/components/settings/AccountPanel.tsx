"use client";
import { enDigits, faDigits } from "@namilux/core/client";
import { PasswordInput } from "@/components/forms/PasswordInput";
import { useEffect, useState } from "react";
import { type SessionRowLite, SessionsTable } from "./SessionsTable";
import { Button, Card, Field, Input } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function AccountPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrol, setEnrol] = useState<{ otpauth: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [sessions, setSessions] = useState<SessionRowLite[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);

  async function loadSessions(): Promise<void> {
    try {
      const r = await api<{ items: SessionRowLite[] }>("/api/account/sessions");
      setSessions(r.items);
      setSessionError(null);
    } catch (error) {
      setSessionError(error instanceof ApiError ? error.message : fa["common.error"]);
    }
  }
  useEffect(() => {
    void loadSessions();
  }, []);

  async function changePassword(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/account/password", { method: "POST", body: { current, next } });
      toast(fa["common.saved"]);
      setCurrent("");
      setNext("");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  async function startTotp(): Promise<void> {
    setBusy(true);
    try {
      setEnrol(await api<{ otpauth: string; secret: string }>("/api/account/totp", { method: "POST", body: {} }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  async function confirmTotp(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/account/totp", { method: "PUT", body: { code } });
      toast(fa["account.totp.done"]);
      setEnrol(null);
      setCode("");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={fa["account.password"]}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void changePassword();
          }}
        >
          <Field label={fa["account.password.current"]}>
            <PasswordInput dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label={fa["account.password.next"]}>
            <PasswordInput dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
          </Field>
          <Button type="submit" disabled={busy}>
            {fa["common.save"]}
          </Button>
        </form>
      </Card>
      <Card title={fa["account.totp.reenrol"]}>
        <p className="mb-3 text-xs text-[var(--ink-2)]">{fa["account.totp.body"]}</p>
        {enrol === null ? (
          <Button variant="outline" disabled={busy} onClick={() => void startTotp()}>
            {fa["account.totp.reenrol"]}
          </Button>
        ) : (
          <div className="space-y-2">
            <a className="ui-btn ui-btn--outline" href={enrol.otpauth}>باز کردن برنامهٔ تأیید دومرحله‌ای</a>
            <p className="ltr font-mono text-xs">{enrol.secret}</p>
            <Field label={fa["auth.totp"]}>
              <Input dir="ltr" inputMode="numeric" maxLength={6} value={faDigits(code)} onChange={(e) => setCode(enDigits(e.target.value).replace(/\D/g, ""))} />
            </Field>
            <Button disabled={busy || code.length !== 6} onClick={() => void confirmTotp()}>
              {fa["common.confirm"]}
            </Button>
          </div>
        )}
      </Card>
      <Card title={fa["account.sessions"]} className="lg:col-span-2">
        {sessionError === null ? <SessionsTable items={sessions} revokeUrl="/api/account/sessions?id={id}" onRevoked={loadSessions} /> : <div role="alert" className="space-y-2 text-sm">
          <p>{sessionError}</p><Button variant="outline" onClick={() => void loadSessions()}>بارگذاری دوبارهٔ دستگاه‌ها</Button>
        </div>}
        <div className="mt-2">
          <ConfirmButton
            label={fa["staff.revokeAll"]}
            confirmLabel="از همهٔ دستگاه‌های دیگر خارج می‌شوید؟"
            variant="outline"
            onConfirm={async () => {
              await api("/api/account/sessions?all=1", { method: "DELETE" });
              toast(fa["sessions.revoked"]);
              await loadSessions();
            }}
          />
        </div>
      </Card>
    </div>
  );
}
