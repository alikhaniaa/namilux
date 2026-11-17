"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_NAMES } from "@namilux/core/client";
import { Button, Field, Input, Select } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ROLE_HINT, STAFF } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

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

/**
 * The «ویرایش» half of the head admin's staff screen: the display name and the role, which are the
 * two fields that are not a one-click button in the table. The login identity is deliberately NOT
 * editable - it is the unique key sessions, the audit log and the TOTP label are keyed on; the
 * owner deletes the account and makes a new one instead.
 */
export function StaffEditForm({ id, name: initialName, role: initialRole, self }: { id: string; name: string; role: string; self: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState(initialRole);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== initialName || role !== initialRole;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/staff/${id}`, {
        method: "PUT",
        body: { name: name.trim(), ...(self || role === initialRole ? {} : { role }) },
      });
      toast(fa["staff.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-3 md:items-end">
      <Field label={fa["staff.name"]} hint={STAFF.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label={fa["staff.role"]} hint={self ? STAFF.roleSelf : `${STAFF.role} ${ROLE_HINT[role] ?? ""}`.trim()}>
        {/* An owner cannot demote themselves: the last active owner must stay one. */}
        <Select value={role} disabled={self} onChange={(e) => setRole(e.target.value)}>
          {ROLE_NAMES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button disabled={busy || !dirty || name.trim().length < 2} onClick={() => void save()}>
          {fa["common.save"]}
        </Button>
      </div>
    </div>
  );
}
