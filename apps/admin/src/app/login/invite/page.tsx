"use client";
import { PasswordInput } from "@/components/forms/PasswordInput";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, Field } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

function InviteForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/staff/invite", { method: "POST", body: { token, password } });
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fa["common.error"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center px-4">
      <Card className="w-full">
        <h1 className="mb-4 text-lg font-semibold">{fa["staff.invite"]}</h1>
        {token === "" ? <p role="alert" className="mb-4 text-sm text-[var(--danger)]">پیوند دعوت کامل نیست. از مدیر فروشگاه بخواهید پیوند دعوت تازه‌ای برایتان بفرستد.</p> : null}
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <Field label={fa["account.password.next"]}>
            <PasswordInput dir="ltr" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error !== null ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || token === ""}>
            {fa["common.confirm"]}
          </Button>
        </form>
      </Card>
    </main>
  );
}

// `useSearchParams` in a client page needs its own Suspense boundary so `next build` can prerender the shell.
export default function InvitePage(): React.ReactNode {
  return (
    <Suspense fallback={<main className="auth-pane"><p role="status">{fa["common.loading"]}</p></main>}>
      <InviteForm />
    </Suspense>
  );
}
