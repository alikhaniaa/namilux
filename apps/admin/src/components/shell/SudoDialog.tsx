"use client";
import { enDigits, faDigits } from "@namilux/core/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/kit-client";
import { Button, Field, Input } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { ApiError, api, setSudoHandler } from "@/lib/api-client";

export function SudoDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setSudoHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setCode("");
          setError(null);
          setOpen(true);
        }),
    );
    return () => setSudoHandler(null);
  }, []);

  const finish = useCallback((ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/sudo", { method: "POST", body: { code } });
      finish(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fa["common.error"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => finish(false)}
      title={fa["sudo.title"]}
      footer={
        <>
          <Button variant="outline" onClick={() => finish(false)} disabled={busy}>
            {fa["common.cancel"]}
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || code.length !== 6}>
            {fa["sudo.confirm"]}
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--ink-2)]">{fa["sudo.body"]}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <Field label={fa["auth.totp"]} hint={fa["auth.totp.hint"]} {...(error === null ? {} : { error })}>
          <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={faDigits(code)} onChange={(e) => setCode(enDigits(e.target.value).replace(/\D/g, ""))} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
