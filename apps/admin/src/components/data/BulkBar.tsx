"use client";
import { useState } from "react";
import { Button } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError } from "@/lib/api-client";

type Action = { key: string; label: string; onRun: (ids: number[]) => Promise<void>; sudo?: boolean; confirm?: (n: number) => string };

export function BulkBar({ selectedIds, actions, onDone }: { selectedIds: number[]; actions: Action[]; onDone?: () => void }): React.ReactNode {
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  if (selectedIds.length === 0) return null;

  async function run(action: Action): Promise<void> {
    setBusy(true);
    try {
      await action.onRun([...selectedIds]);
      setPending(null);
      onDone?.();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {actions.map((a) => (
        <Button key={a.key} size="sm" variant="outline" disabled={busy} onClick={() => (a.confirm !== undefined ? setPending(a) : void run(a))}>
          {a.label}
        </Button>
      ))}
      <Dialog
        open={pending !== null}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        title={pending?.label ?? ""}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>
              {fa["common.cancel"]}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (pending !== null) void run(pending);
              }}
            >
              {busy ? fa["common.loading"] : fa["common.confirm"]}
            </Button>
          </>
        }
      >
        <p className="text-sm">{pending?.confirm?.(selectedIds.length)}</p>
      </Dialog>
    </>
  );
}
