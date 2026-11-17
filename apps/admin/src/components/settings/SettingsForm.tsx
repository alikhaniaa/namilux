"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Code2, X } from "lucide-react";
import { enDigits, faInt, faDigits } from "@namilux/core/client";
import { Button, Field, Input, Select, Switch, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { fa } from "@/i18n/fa";
import { SETTINGS_FIELD_HINT, SETTINGS_GROUP_HINT, SETTINGS_LIST_HINT } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function isObj(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const WEEKDAYS = new Set(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);

/**
 * What «افزودن» puts into an unset field: an hour for `open`/`close`, a day's hours for a weekday, and
 * an empty text for anything else (it used to write a day's hours into every null field, a provider
 * key included, which the save then refused).
 */
function emptyFor(name: string): Json {
  if (name === "open" || name === "close") return "10:00";
  if (WEEKDAYS.has(name)) return { open: "10:00", close: "21:00" };
  return "";
}

/** A whole-Toman amount by its label («… (تومان)») - drawn with the grouped money field. */
const isMoneyLabel = (label: string): boolean => label.includes("(تومان)");

/**
 * `path` is `group.field` (nested: `group.parent.field`); hints are looked up by it rather than by the
 * bare field name, because names like `enabled` or `message` mean different things in each group.
 * `label`/`hint` override the lookups - a group that IS one value («فعال بودن خرید آنلاین») passes
 * its own name and purpose.
 */
function FieldFor({
  name,
  path,
  value,
  onChange,
  labels,
  options,
  label: labelOverride,
  hint: hintOverride,
  multiline = false,
}: {
  name: string;
  path: string;
  value: Json;
  onChange: (v: Json) => void;
  labels: Record<string, string>;
  options: Record<string, { value: number; label: string }[]>;
  label?: string;
  hint?: string;
  multiline?: boolean;
}) {
  const label = labelOverride ?? labels[name] ?? name;
  const hint = hintOverride ?? SETTINGS_FIELD_HINT[path];
  const hintProp = hint === undefined ? {} : { hint };
  if (typeof value === "boolean") {
    // An on/off setting is a switch, its consequence underneath.
    return <Switch label={label} {...(hint === undefined ? {} : { description: hint })} checked={value} onChange={(e) => onChange(e.target.checked)} className="settings-switch" />;
  }
  if (typeof value === "number") {
    // A field whose schema is a union of fixed numbers (e.g. «گرد کردن به») is a menu, not a free box:
    // typing a value the union refuses would only fail on save.
    const choices = options[name];
    if (choices !== undefined) {
      return (
        <Field label={label} {...hintProp}>
          <Select value={faDigits(value)} onChange={(e) => onChange(Number(e.target.value))}>
            {choices.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    }
    if (isMoneyLabel(label)) {
      return <MoneyInput label={label.replace(" (تومان)", "")} value={value} onChange={(v) => onChange(v ?? 0)} {...hintProp} />;
    }
    return (
      <Field label={label} {...hintProp}>
        <Input
          dir="ltr"
          inputMode="decimal"
          className="settings-number"
          value={faDigits(value)}
          onChange={(e) => {
            const n = Number(enDigits(e.target.value));
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      </Field>
    );
  }
  if (typeof value === "string") {
    return (
      <Field label={label} {...hintProp}>
        {multiline || value.length > 80 || name.toLowerCase().includes("body") || name.toLowerCase().includes("message") ? (
          <Textarea rows={multiline ? 5 : 3} dir={multiline ? "ltr" : undefined} className={multiline ? "settings-code" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input dir={/^[ -~]*$/.test(value) && value !== "" ? "ltr" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      </Field>
    );
  }
  if (value === null) {
    return (
      <Field label={label}>
        <span className="settings-empty">
          <span>{fa["settings.notSet"]}</span>
          <Button size="sm" variant="soft" onClick={() => onChange(emptyFor(name))}>
            {fa["common.add"]}
          </Button>
        </span>
      </Field>
    );
  }
  if (Array.isArray(value)) {
    const allScalar = value.every((x) => typeof x === "string" || typeof x === "number");
    if (allScalar) {
      const numeric = value.length > 0 && value.every((x) => typeof x === "number");
      return (
        <Field label={label} hint={hint ?? SETTINGS_LIST_HINT}>
          <Input
            dir="ltr"
            value={value.map(String).join(", ")}
            onChange={(e) => {
              const parts = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s !== "");
              onChange(numeric ? parts.map((p) => Number(enDigits(p))).filter((n) => Number.isFinite(n)) : parts);
            }}
          />
        </Field>
      );
    }
    return (
      <Field label={label}>
        <Textarea
          dir="ltr"
          rows={4}
          className="settings-code"
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value) as Json);
            } catch {
              /* keep typing */
            }
          }}
        />
      </Field>
    );
  }
  const removable = (k: string, v: Json): boolean => v !== null && (k === "open" || k === "close" || isObj(v)) && Object.keys(value).length === 7;
  return (
    <fieldset className="settings-group">
      <legend>{label}</legend>
      {hint !== undefined ? <p className="settings-group__hint">{hint}</p> : null}
      <div className="settings-group__fields">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="settings-group__row">
            <div className="min-w-0 flex-1">
              <FieldFor name={k} path={`${path}.${k}`} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} labels={labels} options={options} />
            </div>
            {removable(k, v) ? (
              <Button size="icon-sm" variant="ghost" aria-label={`${fa["common.delete"]} ${labels[k] ?? k}`} onClick={() => onChange({ ...value, [k]: null })}>
                <X size={15} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsForm({
  group,
  initial,
  readOnly = false,
  labels = {},
  options = {},
  groupLabel,
}: {
  group: string;
  initial: Json;
  readOnly?: boolean;
  labels?: Record<string, string>;
  options?: Record<string, { value: number; label: string }[]>;
  /** The group's own name - the label of a group that is a single value. */
  groupLabel?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Json>(initial);
  const [json, setJson] = useState(false);
  const [raw, setRaw] = useState(JSON.stringify(initial, null, 2));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = (next: Json): void => {
    setValue(next);
    setRaw(JSON.stringify(next, null, 2));
    setDirty(true);
  };

  async function save(): Promise<void> {
    setBusy(true);
    try {
      let v = value;
      if (json) v = JSON.parse(raw) as Json;
      // «خرید اقساطی» re-derives every non-manual instalment price on save; the route reports how
      // many rows moved so the toast says what actually happened to the second storefront.
      const res = await api<{ recomputed?: number }>(`/api/settings/${encodeURIComponent(group)}`, { method: "PUT", body: { value: v } });
      toast(typeof res.recomputed === "number" ? fa["settings.installments.recomputed"].replace("{count}", faInt(res.recomputed)) : fa["settings.saved"]);
      setDirty(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof SyntaxError ? fa["form.invalid"] : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  const groupHint = SETTINGS_GROUP_HINT[group];
  // A group that is ONE value (a switch, a number, a seal's code) gets that one control - it used to
  // be a raw JSON box whose edits never reached `value`, so saving it wrote the old value back.
  const scalar = typeof value === "boolean" || typeof value === "number" || typeof value === "string";
  const isSeal = group.startsWith("seals.");

  return (
    <div className="settings-form">
      <div className="ui-card">
        <div className="ui-card__body settings-form__body">
          {json || (!isObj(value) && !scalar) ? (
            <Textarea dir="ltr" rows={14} className="settings-code" aria-label={fa["settingsField.value"]} value={raw} onChange={(e) => { setRaw(e.target.value); setDirty(true); }} readOnly={readOnly} />
          ) : scalar ? (
            <fieldset disabled={readOnly} className="ui-fieldset">
              <FieldFor
                name={group}
                path={group}
                value={value}
                onChange={update}
                labels={labels}
                options={options}
                label={groupLabel ?? group}
                {...(groupHint === undefined ? {} : { hint: groupHint })}
                multiline={isSeal}
              />
            </fieldset>
          ) : (
            <fieldset disabled={readOnly} className="ui-fieldset settings-form__fields">
              {Object.entries(value).map(([k, v]) => (
                <FieldFor key={k} name={k} path={`${group}.${k}`} value={v} onChange={(nv) => update({ ...(value), [k]: nv })} labels={labels} options={options} />
              ))}
            </fieldset>
          )}
        </div>
      </div>
      {!readOnly ? (
        <div className="form-actions" data-dirty={dirty || undefined}>
          <Button busy={busy} onClick={() => void save()}>
            {busy ? fa["form.saving"] : fa["common.save"]}
          </Button>
          {isObj(value) ? (
            <Button
              variant="ghost"
              icon={<Code2 size={16} aria-hidden="true" />}
              onClick={() => {
                if (json) {
                  try {
                    setValue(JSON.parse(raw) as Json);
                  } catch {
                    toast(fa["form.invalid"], "error");
                    return;
                  }
                }
                setJson(!json);
              }}
            >
              {json ? fa["settings.formView"] : fa["settings.jsonView"]}
            </Button>
          ) : null}
          {dirty ? <span className="form-actions__status">{fa["form.unsaved"]}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
