"use client";
import { useEffect, useState } from "react";
import { Button, Field, Input, Select } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import type { TreeNode } from "@/components/forms/TreePicker";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";
import { latinSlug } from "@/lib/taxonomy";

/**
 * Create a brand or a category without leaving the product form.
 *
 * Both post to the same guarded routes the maintenance screens use (/api/brands, /api/categories - 
 * `catalog.write`, CSRF, audit). The dialog only calls back with the new id; the product form keeps
 * its unsaved edits (it holds them in its own state, which `router.refresh()` does not reset) and
 * selects the new option straight away.
 */

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.code === "CONFLICT" ? fa["tax.conflict"] : e.message;
  return fa["common.error"];
}

export function BrandQuickCreate({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (b: { id: number; name: string }) => void }) {
  const [nameFa, setNameFa] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const effectiveSlug = slugTouched ? slug : latinSlug(nameEn);
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effectiveSlug);
  const ready = nameFa.trim() !== "" && nameEn.trim() !== "" && slugOk;

  const reset = (): void => {
    setNameFa("");
    setNameEn("");
    setSlug("");
    setSlugTouched(false);
    setError("");
  };

  async function submit(): Promise<void> {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id?: number }>("/api/brands", { method: "POST", body: { nameFa: nameFa.trim(), nameEn: nameEn.trim(), slug: effectiveSlug, isActive: true } });
      // The guarded route answers `{ id, tags, revalidate }`; `id` is the only field this dialog uses.
      if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) throw new ApiError("INTERNAL", fa["common.error"]);
      toast(fa["tax.created"].replace("{name}", nameFa.trim()));
      onCreated({ id: r.id, name: nameFa.trim() });
      reset();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={fa["tax.brand.new"]}
      footer={
        <>
          <Button disabled={!ready || busy} aria-busy={busy} onClick={() => void submit()}>
            {busy ? fa["form.saving"] : fa["tax.create"]}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {fa["common.cancel"]}
          </Button>
        </>
      }
    >
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          // A dialog inside the product <form>: Enter must create the brand, not submit the product.
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <Field label={fa["tax.brand.nameFa"]}>
          <Input value={nameFa} onChange={(e) => setNameFa(e.target.value)} maxLength={60} required disabled={busy} />
        </Field>
        <Field label={fa["tax.brand.nameEn"]}>
          <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={60} required disabled={busy} />
        </Field>
        <Field label={fa["tax.brand.slug"]} error={!slugOk && (slugTouched || nameEn.trim() !== "") ? fa["tax.slugInvalid"] : ""}>
          <Input
            dir="ltr"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            maxLength={80}
            disabled={busy}
          />
        </Field>
        {error !== "" ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function flatten(nodes: TreeNode[], depth = 0): { id: number; label: string }[] {
  return nodes.flatMap((n) => [{ id: n.id, label: `${"— ".repeat(depth)}${n.name}` }, ...flatten(n.children, depth + 1)]);
}

export function CategoryQuickCreate({
  open,
  onClose,
  onCreated,
  tree,
  defaultParent,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: { id: number; name: string; parentId: number | null }) => void;
  tree: TreeNode[];
  defaultParent: number | null;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parent, setParent] = useState<string>(defaultParent === null ? "" : String(defaultParent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The dialog is mounted once and reused, so the initial state above would freeze the parent
  // choice of the first opening. `defaultParent` follows the form's primary category and is
  // re-read whenever the dialog opens (nothing can change it while the modal has the screen).
  useEffect(() => {
    if (open) setParent(defaultParent === null ? "" : String(defaultParent));
  }, [open, defaultParent]);
  // Category slugs may be Persian (zSlug): the default is the name with spaces as dashes, and the
  // typed box is kept to the same character set the API accepts instead of failing server-side.
  const cleanSlug = (s: string): string => s.replace(/[\s\u200c/?#%\\]+/g, "-").replace(/\.{2,}/g, ".");
  const effectiveSlug = slug !== "" ? slug : cleanSlug(name.trim());
  const ready = name.trim() !== "" && effectiveSlug !== "" && !effectiveSlug.includes("..");

  async function submit(): Promise<void> {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const parentId = parent === "" ? null : Number(parent);
      const r = await api<{ id?: number }>("/api/categories", { method: "POST", body: { name: name.trim(), slug: effectiveSlug, parentId, status: "active" } });
      // The guarded route answers `{ id, tags, revalidate }`; `id` is the only field this dialog uses.
      if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) throw new ApiError("INTERNAL", fa["common.error"]);
      toast(fa["tax.created"].replace("{name}", name.trim()));
      onCreated({ id: r.id, name: name.trim(), parentId });
      setName("");
      setSlug("");
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={fa["tax.category.new"]}
      footer={
        <>
          <Button disabled={!ready || busy} aria-busy={busy} onClick={() => void submit()}>
            {busy ? fa["form.saving"] : fa["tax.create"]}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {fa["common.cancel"]}
          </Button>
        </>
      }
    >
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <Field label={fa["tax.category.name"]}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required disabled={busy} />
        </Field>
        <Field label={fa["tax.category.parent"]}>
          <Select value={parent} onChange={(e) => setParent(e.target.value)} disabled={busy}>
            <option value="">{fa["tax.category.root"]}</option>
            {flatten(tree).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={fa["tax.category.slug"]}>
          <Input dir="auto" value={effectiveSlug} onChange={(e) => setSlug(cleanSlug(e.target.value.trim()))} maxLength={200} disabled={busy} />
        </Field>
        <p className="text-xs text-[var(--ink-2)]">{fa["tax.category.draftNote"]}</p>
        {error !== "" ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
