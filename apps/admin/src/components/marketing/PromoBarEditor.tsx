"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Banner } from "@namilux/core/client";
import {
  PROMO_BAR_CTA_LABEL_MAX,
  PROMO_BAR_MESSAGES_MAX,
  PROMO_BAR_TITLE_MAX,
  enDigits,
  faInt,
  formatJalali,
  promoCopyValue,
  promoMessageState,
  validatePromoDraft,
} from "@namilux/core/client";
import type { PromoMessageState } from "@namilux/core/client";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { Button, Field, Input, StatusBadge, Switch } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { ApiError, api } from "@/lib/api-client";
import { PromoBarPreview } from "./PromoBarPreview";
import type { PreviewMessage } from "./PromoBarPreview";
import { PROMO_T } from "./promo-bar-copy";

type Row = {
  /** client-only identity: survives reordering, so a field message follows its message */
  k: string;
  id?: number;
  title: string;
  ctaLabel: string;
  ctaHref: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};
type RowField = "title" | "ctaLabel" | "ctaHref" | "startsAt" | "endsAt";
type Settings = { enabled: boolean; rotateSec: number };
type Notice = { text: string; ref?: string | undefined };
type SaveState = "idle" | "saving" | "saved" | "failed";

const STATE_TONE: Record<PromoMessageState, "ok" | "accent" | "muted" | "warn"> = { live: "ok", scheduled: "accent", expired: "warn", off: "muted" };
const ROTATE_KEY = "settings.rotateSec";

// new rows only; stored rows are keyed by their id so the server render and hydration agree
let seq = 0;
const nextKey = (): string => `n${String(++seq)}`;

const fromBanner = (m: Banner): Row => ({
  k: `b${String(m.id)}`,
  id: m.id,
  title: m.title,
  ctaLabel: m.ctaLabel ?? "",
  ctaHref: m.ctaHref ?? "",
  startsAt: m.startsAt,
  endsAt: m.endsAt,
  isActive: m.isActive,
});

/** What would be sent - the dirty check compares this, never the client keys. */
const snapshot = (rows: readonly Row[], enabled: boolean, rotateText: string): string =>
  JSON.stringify([rows.map(({ k: _k, ...r }) => r), enabled, rotateText.trim()]);

/** `{path, message}` pairs from a refusal: the handler's Zod list or the service's single field. */
function serverFieldErrors(details: unknown): { path: string; message: string }[] {
  if (typeof details !== "object" || details === null) return [];
  const list = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!Array.isArray(list)) return [];
  const out: { path: string; message: string }[] = [];
  for (const e of list) {
    if (typeof e !== "object" || e === null) continue;
    const { path, message } = e as { path?: unknown; message?: unknown };
    if (typeof path === "string" && typeof message === "string" && message !== "") out.push({ path, message });
  }
  return out;
}

export function PromoBarEditor({ messages, settings }: { messages: Banner[]; settings: Settings }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => messages.map(fromBanner));
  const [enabled, setEnabled] = useState(settings.enabled);
  const [rotateText, setRotateText] = useState(faInt(settings.rotateSec));
  const [baseline, setBaseline] = useState(() => snapshot(rows, settings.enabled, faInt(settings.rotateSec)));
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const summaryRef = useRef<HTMLDivElement>(null);

  // the live/scheduled badges and the preview follow the clock while the page stays open
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rotateSec = Number(enDigits(rotateText.trim()) || "NaN");
  const dirty = snapshot(rows, enabled, rotateText) !== baseline;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // local rules, re-keyed from list position to the row's client key
  const draftErrors = useMemo(() => {
    const byIndex = validatePromoDraft(
      rows.map((r) => ({ title: r.title, ctaLabel: r.ctaLabel, ctaHref: r.ctaHref, startsAt: r.startsAt, endsAt: r.endsAt })),
      rotateSec,
    );
    const out: Record<string, string> = {};
    for (const [path, msg] of Object.entries(byIndex)) {
      const m = /^messages\.(\d+)\.(\w+)$/.exec(path);
      const row = m === null ? undefined : rows[Number(m[1])];
      out[row === undefined || m === null ? path : `${row.k}.${m[2] ?? ""}`] = msg;
    }
    return out;
  }, [rows, rotateSec]);

  const errorFor = (key: string): string | undefined =>
    serverErrors[key] ?? (attempted || touched.has(key) ? draftErrors[key] : undefined);

  const touch = (key: string): void =>
    setTouched((s) => {
      if (s.has(key)) return s;
      const n = new Set(s);
      n.add(key);
      return n;
    });
  const clearServer = (key: string): void =>
    setServerErrors((e) => {
      if (!(key in e)) return e;
      const { [key]: _gone, ...rest } = e;
      return rest;
    });

  const upd = (k: string, field: RowField | "isActive", patch: Partial<Row>): void => {
    setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...patch } : r)));
    touch(`${k}.${field}`);
    clearServer(`${k}.${field}`);
    if (field === "ctaLabel" || field === "ctaHref") {
      clearServer(`${k}.ctaLabel`);
      clearServer(`${k}.ctaHref`);
    }
    if (field === "startsAt") clearServer(`${k}.endsAt`);
    if (state === "saved") setState("idle");
  };
  const move = (i: number, by: -1 | 1): void =>
    setRows((rs) => {
      const n = [...rs];
      const a = n[i];
      const b = n[i + by];
      if (a === undefined || b === undefined) return rs;
      n[i] = b;
      n[i + by] = a;
      return n;
    });
  const add = (): void => {
    const row: Row = { k: nextKey(), title: "", ctaLabel: "", ctaHref: "", startsAt: null, endsAt: null, isActive: true };
    setRows((rs) => [...rs, row]);
    setPinned(row.k);
    // focus the new title once it is in the DOM
    setTimeout(() => document.getElementById(`promo-${row.k}-title-input`)?.focus(), 0);
  };
  const remove = (k: string): void => {
    setRows((rs) => rs.filter((r) => r.k !== k));
    if (pinned === k) setPinned(null);
  };

  // everything that currently blocks a save, in page order, for the persistent summary
  const problems: { key: string; label: string; message: string }[] = [];
  const rotateErr = errorFor(ROTATE_KEY);
  if (rotateErr !== undefined) problems.push({ key: ROTATE_KEY, label: PROMO_T.rotate, message: rotateErr });
  const listErr = serverErrors.messages ?? (attempted ? draftErrors.messages : undefined);
  if (listErr !== undefined) problems.push({ key: "messages", label: PROMO_T.listTitle, message: listErr });
  const fieldLabel: Record<RowField, string> = { title: PROMO_T.title, ctaLabel: PROMO_T.ctaLabel, ctaHref: PROMO_T.ctaHref, startsAt: PROMO_T.startsAt, endsAt: PROMO_T.endsAt };
  rows.forEach((r, i) => {
    for (const f of ["title", "ctaLabel", "ctaHref", "startsAt", "endsAt"] as const) {
      const msg = errorFor(`${r.k}.${f}`);
      if (msg !== undefined) problems.push({ key: `${r.k}.${f}`, label: `${PROMO_T.messageN(faInt(i + 1))}: ${fieldLabel[f]}`, message: msg });
    }
    const other = serverErrors[`${r.k}.id`] ?? serverErrors[`${r.k}.slot`];
    if (other !== undefined) problems.push({ key: `${r.k}.title`, label: PROMO_T.messageN(faInt(i + 1)), message: other });
  });

  async function save(): Promise<void> {
    setAttempted(true);
    if (Object.keys(draftErrors).length > 0) {
      setNotice({ text: PROMO_T.fixFirst });
      setState("failed");
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const sent = rows;
    setState("saving");
    setNotice(null);
    try {
      const res = await api<{ ids?: number[] }>("/api/promo", {
        method: "PUT",
        body: {
          messages: sent.map((r, i) => ({
            ...(r.id === undefined ? {} : { id: r.id }),
            slot: "promo_bar",
            title: promoCopyValue(r.title),
            ctaLabel: r.ctaLabel.trim() === "" ? null : r.ctaLabel.trim(),
            ctaHref: r.ctaHref.trim() === "" ? null : r.ctaHref.trim(),
            theme: "auto",
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            isActive: r.isActive,
            sort: i,
          })),
          settings: { enabled, rotateSec },
        },
      });
      // new messages now have ids: without them a second save would create them again
      const ids = res.ids ?? [];
      const keyed = new Map(sent.map((r, i) => [r.k, ids[i]]));
      setRows((rs) =>
        rs.map((r) => {
          const id = keyed.get(r.k);
          return id === undefined ? r : { ...r, id };
        }),
      );
      setBaseline(
        snapshot(
          sent.map((r) => {
            const id = keyed.get(r.k) ?? r.id;
            return id === undefined ? r : { ...r, id };
          }),
          enabled,
          rotateText,
        ),
      );
      setServerErrors({});
      setAttempted(false);
      setTouched(new Set());
      setState("saved");
      setSavedAt(formatJalali(new Date().toISOString(), "short"));
      toast(PROMO_T.savedToast);
      router.refresh();
    } catch (e) {
      setState("failed");
      if (e instanceof ApiError) {
        const mapped: Record<string, string> = {};
        for (const { path, message } of serverFieldErrors(e.details)) {
          const m = /^messages\.(\d+)\.(\w+)/.exec(path);
          const row = m === null ? undefined : sent[Number(m[1])];
          if (row !== undefined && m !== null) mapped[`${row.k}.${m[2] ?? ""}`] = message;
          else if (path === ROTATE_KEY || path === "messages") mapped[path] = message;
        }
        setServerErrors(mapped);
        setNotice({ text: `${PROMO_T.failed} ${e.message}`, ref: e.ref });
      } else {
        setNotice({ text: PROMO_T.unknown });
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  // ---- preview model
  const states = rows.map((r) => promoMessageState(r, now));
  const previewOf = (r: Row, i: number): PreviewMessage => ({
    key: r.k,
    title: promoCopyValue(r.title) || "…",
    linked: r.ctaHref.trim() !== "",
    position: i + 1,
  });
  const live = rows.flatMap((r, i) => (states[i] === "live" && promoCopyValue(r.title) !== "" ? [previewOf(r, i)] : []));
  const pinIndex = pinned === null ? -1 : rows.findIndex((r) => r.k === pinned);
  const pinnedRow = pinIndex < 0 ? undefined : rows[pinIndex];
  const pinnedMsg = pinnedRow === undefined ? null : previewOf(pinnedRow, pinIndex);

  let status: string;
  if (state === "saving") status = PROMO_T.saving;
  else if (dirty) status = PROMO_T.dirty;
  else if (state === "saved" && savedAt !== null) status = PROMO_T.savedAt(savedAt);
  else status = PROMO_T.clean;

  const showSummary = notice !== null || (problems.length > 0 && (attempted || Object.keys(serverErrors).length > 0));

  return (
    <div className="space-y-6">
      <section className="border border-[var(--line)] bg-[var(--bg-soft)] p-4">
        <h2 className="mb-2 text-sm font-semibold">{PROMO_T.aboutTitle}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm leading-7 text-[var(--ink-2)]">
          <li>{PROMO_T.aboutWhere}</li>
          <li>{PROMO_T.aboutMaster}</li>
          <li>{PROMO_T.aboutEach}</li>
          <li>{PROMO_T.aboutSchedule}</li>
          <li>{PROMO_T.aboutOrder}</li>
        </ul>
      </section>

      <PromoBarPreview
        enabled={enabled}
        rotateSec={rotateSec}
        live={live}
        pinned={pinnedMsg}
        total={rows.length}
      />

      {showSummary ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="space-y-2 border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm outline-none"
        >
          {notice !== null ? <p className="font-medium">{notice.text}</p> : null}
          {problems.length > 0 ? (
            <>
              <p className="font-semibold">{PROMO_T.summaryTitle(faInt(problems.length))}</p>
              <ul className="list-disc space-y-1 ps-5">
                {problems.map((p) => (
                  <li key={`${p.key}:${p.message}`}>
                    <a className="underline underline-offset-4" href={`#promo-${p.key.replace(".", "-")}`}>
                      {p.label}
                    </a>
                    : {p.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {notice?.ref !== undefined ? (
            <p dir="ltr" className="text-end text-xs text-[var(--ink-3)]">
              {PROMO_T.ref(notice.ref)}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3 border border-[var(--line)] p-4">
        <h2 className="text-sm font-semibold">{PROMO_T.settingsTitle}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Switch label={PROMO_T.enabled} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <p className="text-xs text-[var(--ink-3)]">{enabled ? PROMO_T.enabledOnHint : PROMO_T.enabledOffHint}</p>
          </div>
          <div id="promo-settings-rotateSec">
            <Field label={PROMO_T.rotate} hint={PROMO_T.rotateHint} {...(rotateErr === undefined ? {} : { error: rotateErr })}>
              <Input
                inputMode="numeric"
                className="w-24"
                value={rotateText}
                aria-invalid={rotateErr !== undefined}
                onChange={(e) => {
                  setRotateText(e.target.value);
                  touch(ROTATE_KEY);
                  clearServer(ROTATE_KEY);
                }}
                onBlur={() => {
                  const n = Number(enDigits(rotateText.trim()));
                  if (rotateText.trim() !== "" && Number.isFinite(n)) setRotateText(faInt(n));
                }}
              />
            </Field>
          </div>
        </div>
      </section>

      <section id="promo-messages" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {PROMO_T.listTitle} ({faInt(rows.length)} / {faInt(PROMO_BAR_MESSAGES_MAX)})
          </h2>
          <span className="text-xs text-[var(--ink-3)]">{PROMO_T.listHint}</span>
        </div>

        {rows.length === 0 ? (
          <div className="border border-dashed border-[var(--line-2)] p-8 text-center">
            <p className="font-semibold">{PROMO_T.emptyTitle}</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-7 text-[var(--ink-3)]">{PROMO_T.emptyBody}</p>
            <Button className="mt-4" onClick={add}>
              {PROMO_T.add}
            </Button>
          </div>
        ) : (
          <ol className="space-y-3">
            {rows.map((r, i) => {
              const st = states[i] ?? "off";
              const n = faInt(i + 1);
              const err = (f: RowField): { error: string } | Record<string, never> => {
                const m = errorFor(`${r.k}.${f}`);
                return m === undefined ? {} : { error: m };
              };
              const when =
                st === "scheduled" && r.startsAt !== null
                  ? PROMO_T.stateWhen.scheduled(formatJalali(r.startsAt, "short"))
                  : st === "live" && r.endsAt !== null
                    ? PROMO_T.stateWhen.live(formatJalali(r.endsAt, "short"))
                    : st === "expired" && r.endsAt !== null
                      ? PROMO_T.stateWhen.expired(formatJalali(r.endsAt, "short"))
                      : null;
              const titleLen = promoCopyValue(r.title).length;
              return (
                <li
                  key={r.k}
                  className={`space-y-3 border p-4 ${pinned === r.k ? "border-[var(--accent)]" : "border-[var(--line)]"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{PROMO_T.messageN(n)}</span>
                      <StatusBadge tone={STATE_TONE[st]}>{PROMO_T.state[st]}</StatusBadge>
                      {when !== null ? <span className="text-xs text-[var(--ink-3)]">{when}</span> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button size="sm" variant="ghost" aria-pressed={pinned === r.k} onClick={() => setPinned(pinned === r.k ? null : r.k)}>
                        {PROMO_T.previewPin}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={i === 0} aria-label={`${PROMO_T.moveUp}: ${PROMO_T.messageN(n)}`} onClick={() => move(i, -1)}>
                        ↑ {PROMO_T.moveUp}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={i === rows.length - 1} aria-label={`${PROMO_T.moveDown}: ${PROMO_T.messageN(n)}`} onClick={() => move(i, 1)}>
                        ↓ {PROMO_T.moveDown}
                      </Button>
                      <Button size="sm" variant="danger" aria-label={`${PROMO_T.remove}: ${PROMO_T.messageN(n)}`} onClick={() => remove(r.k)}>
                        {PROMO_T.remove}
                      </Button>
                    </div>
                  </div>

                  <div id={`promo-${r.k}-title`}>
                    <Field
                      label={PROMO_T.title}
                      hint={PROMO_T.titleHint}
                      action={
                        <span className={`text-xs ${titleLen > PROMO_BAR_TITLE_MAX ? "text-[var(--danger)]" : "text-[var(--ink-3)]"}`}>
                          {faInt(titleLen)} / {faInt(PROMO_BAR_TITLE_MAX)}
                        </span>
                      }
                      {...err("title")}
                    >
                      <Input
                        id={`promo-${r.k}-title-input`}
                        value={r.title}
                        aria-invalid={errorFor(`${r.k}.title`) !== undefined}
                        onChange={(e) => upd(r.k, "title", { title: e.target.value })}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div id={`promo-${r.k}-ctaLabel`}>
                      <Field label={PROMO_T.ctaLabel} hint={PROMO_T.ctaLabelHint} {...err("ctaLabel")}>
                        <Input
                          value={r.ctaLabel}
                          maxLength={PROMO_BAR_CTA_LABEL_MAX * 2}
                          aria-invalid={errorFor(`${r.k}.ctaLabel`) !== undefined}
                          onChange={(e) => upd(r.k, "ctaLabel", { ctaLabel: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div id={`promo-${r.k}-ctaHref`}>
                      <Field label={PROMO_T.ctaHref} hint={PROMO_T.ctaHrefHint} {...err("ctaHref")}>
                        <Input
                          dir="ltr"
                          value={r.ctaHref}
                          placeholder="/c/…"
                          aria-invalid={errorFor(`${r.k}.ctaHref`) !== undefined}
                          onChange={(e) => upd(r.k, "ctaHref", { ctaHref: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div id={`promo-${r.k}-startsAt`}>
                      <Field group label={PROMO_T.startsAt} hint={PROMO_T.startsAtHint} {...err("startsAt")}>
                        <JalaliDate value={r.startsAt} onChange={(iso) => upd(r.k, "startsAt", { startsAt: iso })} withTime />
                      </Field>
                    </div>
                    <div id={`promo-${r.k}-endsAt`}>
                      <Field group label={PROMO_T.endsAt} hint={PROMO_T.endsAtHint} {...err("endsAt")}>
                        <JalaliDate value={r.endsAt} onChange={(iso) => upd(r.k, "endsAt", { endsAt: iso })} withTime />
                      </Field>
                    </div>
                  </div>

                  <Switch label={PROMO_T.isActive} checked={r.isActive} onChange={(e) => upd(r.k, "isActive", { isActive: e.target.checked })} />
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="form-actions justify-between gap-3">
        <p className={`text-sm ${dirty ? "font-medium" : "text-[var(--ink-3)]"}`} aria-live="polite">
          {status}
        </p>
        <div className="flex flex-wrap gap-2">
          {rows.length > 0 ? (
            <Button variant="outline" disabled={rows.length >= PROMO_BAR_MESSAGES_MAX} onClick={add}>
              {rows.length >= PROMO_BAR_MESSAGES_MAX ? PROMO_T.addFull : PROMO_T.add}
            </Button>
          ) : null}
          <Button disabled={state === "saving" || !dirty} aria-busy={state === "saving"} onClick={() => void save()}>
            {state === "saving" ? PROMO_T.saving : PROMO_T.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
