"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ZodType } from "zod";
import { Button } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";
import { fieldErrorsFromIssues } from "@/lib/error-detail";
import type { FieldError } from "@/lib/error-detail";

export type FormApi<T> = {
  values: T;
  set: (path: string, v: unknown) => void;
  errors: Record<string, string>;
  submitting: boolean;
  dirty: boolean;
};

/**
 * What the persistent summary above the form shows after a refused save: the fields the server (or
 * the local schema) named, and the request ref support asks for. It stays until the next submit.
 */
type FormSummary = { title: string; items: FieldError[]; ref?: string };

/** The path→message map the fields read; form-level entries (no path) live in the summary only. */
function fieldErrorMap(items: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of items) {
    if (item.path === "" || map[item.path] !== undefined) continue;
    map[item.path] = item.message;
  }
  return map;
}

function setPath(obj: unknown, path: string, value: unknown): unknown {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i] ?? "";
    const next = cur[k];
    cur[k] = Array.isArray(next) ? [...(next as unknown[])] : typeof next === "object" && next !== null ? { ...(next as Record<string, unknown>) } : {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1] ?? ""] = value;
  return clone;
}

export function Form<T>({
  schemaKey,
  schema,
  initial,
  action,
  method,
  draftKey,
  children,
  onSaved,
  submitLabel,
  extraActions,
  readOnly = false,
}: {
  schemaKey: string;
  schema?: ZodType;
  initial: T;
  action: string;
  method: "POST" | "PUT";
  draftKey?: string;
  children: (f: FormApi<T>) => React.ReactNode;
  onSaved?: (data: unknown) => void;
  submitLabel?: string;
  extraActions?: React.ReactNode;
  /** A reader without the write permission: the same screen, nothing to save, no draft kept. */
  readOnly?: boolean;
}) {
  const storage = draftKey === undefined || readOnly ? null : `nl.admin.draft.${schemaKey}.${draftKey}`;
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<FormSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftFound, setDraftFound] = useState<T | null>(null);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (storage === null) return;
    try {
      const raw = localStorage.getItem(storage);
      if (raw !== null) setDraftFound(JSON.parse(raw) as T);
    } catch {
      /* ignore a corrupt draft */
    }
  }, [storage]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const set = useCallback(
    (path: string, v: unknown): void => {
      setValues((prev) => {
        const next = setPath(prev, path, v) as T;
        if (storage !== null) {
          if (saveTimer.current !== null) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            try {
              localStorage.setItem(storage, JSON.stringify(next));
            } catch {
              /* quota */
            }
          }, 600);
        }
        return next;
      });
      setDirty(true);
      setErrors((prev) => {
        if (!(path in prev)) return prev;
        const { [path]: _drop, ...rest } = prev;
        return rest;
      });
    },
    [storage],
  );

  async function submit(): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setSubmitting(true);
    setErrors({});
    setSummary(null);
    try {
      let body = values as unknown;
      if (schema !== undefined) {
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
          // The same translation the server applies: Persian, bounded, and never a raw Zod string.
          const items = fieldErrorsFromIssues(parsed.error.issues, values);
          setErrors(fieldErrorMap(items));
          setSummary({ title: fa["form.invalid"], items });
          toast(fa["form.invalid"], "error");
          return;
        }
        body = parsed.data;
      }
      const data = await api(action, { method, body: body as Record<string, unknown> });
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      setDirty(false);
      setDraftFound(null);
      if (storage !== null) {
        try {
          localStorage.removeItem(storage);
        } catch {
          /* ignore */
        }
      }
      if (onSaved === undefined) toast(fa["common.saved"]);
      onSaved?.(data);
    } catch (e) {
      if (e instanceof ApiError) {
        // Server field errors land in the same map the fields already read; the values the editor
        // typed are untouched, so nothing has to be re-entered.
        const items = e.fieldErrors;
        setErrors(fieldErrorMap(items));
        setSummary(items.length === 0 ? null : { title: fa["form.invalid"], items, ...(e.ref === undefined ? {} : { ref: e.ref }) });
        // The summary already lists each field with its correction; the toast keeps the cause, the
        // recovery and the diagnostic without repeating that list.
        toast(items.length === 0 ? e.message : e.brief, "error");
      } else {
        setSummary(null);
        toast(fa["common.error"], "error");
      }
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (readOnly || !e.currentTarget.reportValidity()) return;
        void submit();
      }}
    >
      {draftFound !== null ? (
        <div className="form-draft">
          <span>{fa["form.draftRestored"]}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setValues({ ...initial, ...draftFound });
              setDirty(true);
              setDraftFound(null);
            }}
          >
            {fa["common.apply"]}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (storage !== null) localStorage.removeItem(storage);
              setDraftFound(null);
            }}
          >
            {fa["form.discardDraft"]}
          </Button>
        </div>
      ) : null}
      {summary !== null ? (
        // Persistent, announced once (role="alert") and never stealing focus: the editor keeps the
        // caret where it was and can scroll back to this list, or copy the ref to support.
        <div role="alert" className="ui-alert ui-alert--error form-summary">
          <p className="ui-alert__title">{summary.title}</p>
          {summary.items.length > 0 ? (
            <ul className="ms-4 list-disc space-y-1">
              {summary.items.map((item, i) => (
                <li key={`${item.path}:${String(i)}`}>
                  {item.path === "" ? null : <span className="font-medium">{item.label ?? "بخش مشخص‌شده"}: </span>}
                  <span className="select-text">{item.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.ref !== undefined ? <p className="select-text text-xs text-[var(--ink-2)]">{fa["error.ref"].replace("{ref}", summary.ref)}</p> : null}
        </div>
      ) : null}
      {/* One white sheet for the fields, on the panel's grey ground - the form reads as a document. */}
      <fieldset disabled={submitting || readOnly} className="form-sheet min-w-0">{children({ values, set, errors, submitting, dirty })}</fieldset>
      {readOnly ? null : (
        <div className="form-actions" data-dirty={dirty || undefined}>
          <Button type="submit" disabled={submitting} busy={submitting}>
            {submitting ? fa["form.saving"] : (submitLabel ?? fa["common.save"])}
          </Button>
          <div className="form-actions__secondary">{extraActions}</div>
          {dirty ? <span className="form-actions__status">{fa["form.unsaved"]}</span> : null}
        </div>
      )}
    </form>
  );
}
