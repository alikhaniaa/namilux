"use client";
import { PasswordInput } from "@/components/forms/PasswordInput";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Plus, Power, ShieldOff, Trash2 } from "lucide-react";
import { ROLE_NAMES, formatJalali, staffCreateSchema } from "@namilux/core/client";
import { Avatar, Button, EmptyRow, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/kit";
import { ConfirmButton, Dialog, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";
import { staffValidationErrors } from "@/lib/staff-validation";

export type StaffRowLite = { id: string; email: string; name: string; role: string; isActive: boolean; totpEnabled: boolean; lastLoginAt: string | null; lockedUntil: string | null; mustChangePassword: boolean; createdAt: string };

/** Persian names for the role rows, in the order the picker shows them. */
const ROLE_LABELS: Record<(typeof ROLE_NAMES)[number], string> = {
  owner: fa["role.owner"],
  admin: fa["role.admin"],
  instalments: fa["role.instalments"],
  manager: fa["role.manager"],
  orders: fa["role.orders"],
  content: fa["role.content"],
  support: fa["role.support"],
  viewer: fa["role.viewer"],
};
const roleLabel = (role: string): string =>
  Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role as (typeof ROLE_NAMES)[number]] : role;

/**
 * The head admin's staff screen. Everything here is behind `staff.manage`, which only the owner
 * holds and which needs a fresh TOTP (sudo) before any write - the page is not rendered at all for
 * an admin, and every button below would still be refused by the route if it were.
 */
export function StaffTable({ title, items, selfId }: { title: string; items: StaffRowLite[]; selfId: string }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("admin");
  // The one-time password: shown once, in a dialog, and dropped the moment it is closed.
  const [issued, setIssued] = useState<{ who: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const createBody = { email: email.trim(), name: name.trim(), role, ...(password === "" ? {} : { password }) };
  const validation = staffCreateSchema.safeParse(createBody);
  const errors = attempted && !validation.success ? staffValidationErrors(validation.error) : {};

  function failed(e: unknown): void {
    const message = e instanceof ApiError && e.message !== "" ? e.message : fa["common.error"];
    toast(message, "error");
  }

  /** Always open «افزودن کارمند» empty: a cancelled dialog used to come back with its old values. */
  function openAdd(): void {
    setAttempted(false);
    setEmail("");
    setName("");
    setPassword("");
    setRole("admin");
    setAddOpen(true);
  }

  async function update(id: string, patch: Record<string, unknown>, who: string): Promise<void> {
    try {
      const r = await api<{ password?: string }>(`/api/staff/${id}`, { method: "PUT", body: patch });
      if (typeof r.password === "string") setIssued({ who, password: r.password });
      else toast(fa["staff.saved"]);
      router.refresh();
    } catch (e) {
      failed(e);
    }
  }

  /**
   * «حذف کامل». `staff.manage` is a sudo permission, so the first DELETE is answered 403 with
   * `sudoRequired`; `api` turns that into the «تأیید دوباره» prompt and replays the request, exactly
   * as it does for the PUT behind «غیرفعال». Whatever the second answer is, it is Persian and it is
   * shown - a dismissed prompt included.
   */
  async function remove(id: string): Promise<void> {
    try {
      await api(`/api/staff/${id}?hard=1`, { method: "DELETE" });
      toast(fa["staff.deleted"]);
      router.refresh();
    } catch (e) {
      failed(e);
    }
  }

  async function create(): Promise<void> {
    setAttempted(true);
    if (!validation.success) return;
    setBusy(true);
    try {
      const r = await api<{ password: string }>("/api/staff", {
        method: "POST",
        body: createBody,
      });
      setAddOpen(false);
      setEmail("");
      setName("");
      setPassword("");
      setIssued({ who: name.trim(), password: r.password });
      toast(fa["staff.created"]);
      router.refresh();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title={title}
        count={items.length}
        actions={
          <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openAdd}>
            {fa["staff.add"]}
          </Button>
        }
      />
      <Table minWidth={1080}>
        <thead>
          <tr>
            <Th>{fa["staff.name"]}</Th>
            <Th>{fa["staff.identity"]}</Th>
            <Th>{fa["staff.role"]}</Th>
            <Th>{fa["staff.totp"]}</Th>
            <Th>{fa["staff.lastLogin"]}</Th>
            <Th>{fa["common.actions"]}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className={s.isActive ? undefined : "is-inactive"}>
              <Td>
                <span className="cell-person">
                  <Avatar name={s.name} size="sm" />
                  <span className="cell-person__text">
                    <Link href={`/settings/staff/${s.id}`} className="font-semibold hover:text-[var(--accent)]">
                      {s.name}
                    </Link>
                    <span className="staff-badges">
                      {s.id === selfId ? <StatusBadge tone="accent">{fa["staff.self"]}</StatusBadge> : null}
                      {s.isActive ? null : <StatusBadge tone="muted">{fa["staff.deactivate"]}</StatusBadge>}
                      {s.lockedUntil !== null && s.lockedUntil > new Date().toISOString() ? <StatusBadge tone="warn">{fa["auth.locked"]}</StatusBadge> : null}
                      {s.mustChangePassword ? <StatusBadge tone="warn">{fa["staff.mustChange"]}</StatusBadge> : null}
                    </span>
                  </span>
                </span>
              </Td>
              <Td ltr className="text-xs">
                {s.email}
              </Td>
              <Td>
                <Select className="h-8 w-44 text-xs" value={s.role} disabled={s.id === selfId} onChange={(e) => void update(s.id, { role: e.target.value }, s.name)}>
                  {ROLE_NAMES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td>
                <StatusBadge tone={s.totpEnabled ? "ok" : "warn"}>{s.totpEnabled ? fa["common.yes"] : fa["common.no"]}</StatusBadge>
              </Td>
              <Td className="text-xs">{s.lastLoginAt === null ? fa["common.none"] : formatJalali(s.lastLoginAt, "short")}</Td>
              <Td>
                <span className="staff-actions">
                  <ConfirmButton
                    label={fa["staff.password.reset"]}
                    confirmLabel={fa["common.confirm"]}
                    variant="ghost"
                    size="sm"
                    icon={<KeyRound size={14} aria-hidden="true" />}
                    onConfirm={() => update(s.id, { resetPassword: true }, s.name)}
                  />
                  <ConfirmButton label={fa["staff.resetTotp"]} confirmLabel={fa["common.confirm"]} variant="ghost" size="sm" icon={<ShieldOff size={14} aria-hidden="true" />} onConfirm={() => update(s.id, { forceTotpReenrol: true }, s.name)} />
                  {s.id !== selfId ? (
                    <Button size="sm" variant={s.isActive ? "ghost" : "outline"} icon={<Power size={14} aria-hidden="true" />} onClick={() => void update(s.id, { isActive: !s.isActive }, s.name)}>
                      {s.isActive ? fa["staff.deactivate"] : fa["staff.activate"]}
                    </Button>
                  ) : null}
                  {s.id !== selfId ? (
                    <ConfirmButton label={fa["staff.delete"]} confirmLabel={fa["staff.delete.confirm"]} size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onConfirm={() => remove(s.id)} />
                  ) : null}
                </span>
              </Td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={6} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={fa["staff.add"]}
        footer={
          <Button disabled={busy} onClick={() => void create()}>
            {fa["staff.create"]}
          </Button>
        }
      >
        <Field label={fa["staff.identity"]} hint={fa["staff.identity.hint"]} error={errors.email ?? ""}>
          <Input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} aria-invalid={Boolean(errors.email)} />
        </Field>
        <Field label={fa["staff.name"]} error={errors.name ?? ""}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label={fa["staff.role"]} error={errors.role ?? ""}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={fa["staff.password.initial"]} hint={fa["staff.password.auto"]} error={errors.password ?? ""}>
          <PasswordInput dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "staff-password-error" : undefined} />
          {errors.password ? <span id="staff-password-error" className="sr-only" role="alert">{errors.password}</span> : null}
        </Field>
      </Dialog>

      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title={fa["staff.password.initial"]}
        footer={
          <Button variant="outline" onClick={() => setIssued(null)}>
            {fa["common.close"]}
          </Button>
        }
      >
        <div className="space-y-2">
          <p className="text-sm">{issued?.who}</p>
          <Input dir="ltr" readOnly value={issued?.password ?? ""} onFocus={(e) => e.target.select()} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(issued?.password ?? "").then(() => toast(fa["common.copied"]))}
          >
            {fa["common.copy"]}
          </Button>
          <p className="text-xs text-[var(--ink-2)]">{fa["staff.password.once"]}</p>
        </div>
      </Dialog>
    </div>
  );
}
