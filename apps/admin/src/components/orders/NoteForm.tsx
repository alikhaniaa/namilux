"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function NoteForm({ code }: { code: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/orders/${code}`, { method: "PUT", body: { adminNote: text.trim() } });
      setText("");
      toast(fa["common.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Textarea rows={2} className="flex-1" placeholder={fa["orders.addNote"]} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      <Button type="submit" size="sm" variant="outline" disabled={busy || text.trim() === ""}>
        {fa["orders.addNote"]}
      </Button>
    </form>
  );
}
