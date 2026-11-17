"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatJalali } from "@namilux/core/client";
import { toman } from "@/lib/money";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, EmptyRow, Field, Input, Select, StatusBadge, Switch, Table, Td, Th } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type ReturnRowLite = { requestId: string; orderId: string; orderCode: string; phoneMasked: string; reason: string; requestedAt: string; status: "pending" | "accepted" | "rejected"; decidedAt: string | null; grandTotal: number; orderStatus: string; channel?: "main" | "instalments" };

export function ReturnsTable({ items, canDecide, showChannel = false }: { items: ReturnRowLite[]; canDecide: boolean; showChannel?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<ReturnRowLite | null>(null);
  const [decision, setDecision] = useState<"accept" | "reject">("accept");
  const [restock, setRestock] = useState(true);
  const [amount, setAmount] = useState<number | null>(null);
  const [via, setVia] = useState<"gateway" | "manual">("manual");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function start(r: ReturnRowLite): void {
    setOpen(r);
    setDecision("accept");
    setRestock(true);
    setAmount(r.grandTotal);
    setNote("");
  }
  async function submit(): Promise<void> {
    if (open === null) return;
    setBusy(true);
    try {
      await api(`/api/returns/${open.requestId}`, {
        method: "POST",
        body: {
          decision,
          restock,
          ...(decision === "accept" && amount !== null && amount > 0 ? { refundAmount: amount, via } : {}),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
      });
      toast(fa["returns.decided"]);
      setOpen(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Table minWidth={760}>
        <thead>
          <tr>
            <Th>{fa["orders.code"]}</Th>
            <Th>{fa["customers.phone"]}</Th>
            <Th>{fa["returns.reason"]}</Th>
            <Th>{fa["orders.total"]}</Th>
            <Th>{fa["returns.requestedAt"]}</Th>
            {showChannel ? <Th>{fa["orders.channel"]}</Th> : null}
            <Th>{fa["common.status"]}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.requestId}>
              <Td className="cell-code">
                <Link href={`/orders/${r.orderCode}`} className="hover:text-[var(--accent)]">
                  {r.orderCode}
                </Link>
              </Td>
              <Td ltr className="text-xs">
                {r.phoneMasked}
              </Td>
              <Td className="max-w-xs text-xs">{r.reason}</Td>
              <Td className="cell-num">{toman(r.grandTotal)}</Td>
              <Td className="cell-muted">{formatJalali(r.requestedAt, "short")}</Td>
              {showChannel ? (
                <Td>
                  {r.channel === undefined ? null : (
                    <span className="site-chip site-chip--sm" data-site={r.channel}>
                      <span className="site-dot" data-site={r.channel} aria-hidden="true" />
                      {fa[`channel.${r.channel}`]}
                    </span>
                  )}
                </Td>
              ) : null}
              <Td>
                <StatusBadge tone={r.status === "accepted" ? "ok" : r.status === "rejected" ? "muted" : "warn"}>{fa[`returns.status.${r.status}`]}</StatusBadge>
              </Td>
              <Td>
                {canDecide && r.status === "pending" ? (
                  <Button size="sm" variant="soft" onClick={() => start(r)}>
                    {fa["returns.decide"]}
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={showChannel ? 8 : 7} text={fa["returns.empty"]} /> : null}
        </tbody>
      </Table>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.orderCode ?? ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {fa["common.cancel"]}
            </Button>
            <Button variant={decision === "reject" ? "danger" : "default"} busy={busy} onClick={() => void submit()}>
              {decision === "accept" ? fa["returns.accept"] : fa["returns.reject"]}
            </Button>
          </>
        }
      >
        {open !== null ? <p className="ui-note">{open.reason}</p> : null}
        <Field label={fa["returns.decision"]}>
          <Select value={decision} onChange={(e) => setDecision(e.target.value as "accept" | "reject")}>
            <option value="accept">{fa["returns.accept"]}</option>
            <option value="reject">{fa["returns.reject"]}</option>
          </Select>
        </Field>
        {decision === "accept" ? (
          <>
            <Switch label={fa["returns.restock"]} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            <MoneyInput label={fa["returns.refundAmount"]} value={amount} onChange={setAmount} />
            <Field label={fa["returns.refundVia"]}>
              <Select value={via} onChange={(e) => setVia(e.target.value as "gateway" | "manual")}>
                <option value="manual">{fa["orders.refund.manual"]}</option>
                <option value="gateway">{fa["orders.refund.gateway"]}</option>
              </Select>
            </Field>
          </>
        ) : null}
        <Field label={fa["orders.adminNote"]}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </Dialog>
    </>
  );
}
