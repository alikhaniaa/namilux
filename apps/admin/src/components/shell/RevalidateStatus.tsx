"use client";
import { useEffect, useState } from "react";
import { fa } from "@/i18n/fa";
import { REVALIDATE_EVENT, api, type RevalidateEvent } from "@/lib/api-client";

type State = { status: "idle" | "pending" | "done" | "failed"; tags: string[] };

/**
 * `canRetry` is `system.cache`. The retry button posts to /api/cache/revalidate, which the route
 * refuses without it - so a staff member who may not flip a cache tag is not offered the button.
 */
export function RevalidateStatus({ canRetry }: { canRetry: boolean }) {
  const [state, setState] = useState<State>({ status: "idle", tags: [] });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onEvent = (e: Event): void => {
      const detail = (e as CustomEvent<RevalidateEvent>).detail;
      setState({ status: "pending", tags: detail.tags });
      if (timer !== null) clearTimeout(timer);
      // The admin's send() is fire-and-forget (HMAC POST to the storefront); the storefront reflects
      // a save within seconds, so the chip settles on «به‌روز شد» after a beat and
      // fades - a failed hop surfaces in the cache screen, where «تلاش دوباره» lives too.
      timer = setTimeout(() => {
        setState((s) => ({ ...s, status: "done" }));
        timer = setTimeout(() => setState({ status: "idle", tags: [] }), 6000);
      }, 1500);
    };
    window.addEventListener(REVALIDATE_EVENT, onEvent);
    return () => {
      window.removeEventListener(REVALIDATE_EVENT, onEvent);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  async function retry(): Promise<void> {
    try {
      await api("/api/cache/revalidate", { method: "POST", body: { tags: state.tags } });
      setState((s) => ({ ...s, status: "done" }));
    } catch {
      setState((s) => ({ ...s, status: "failed" }));
    }
  }

  if (state.status === "idle") return null;
  const text =
    state.status === "pending" ? fa["common.revalidate.pending"] : state.status === "done" ? fa["common.revalidate.done"] : fa["common.revalidate.failed"];
  return (
    <span className={`inline-flex items-center gap-2 border px-2 py-0.5 text-xs ${state.status === "failed" ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--line)] text-[var(--ink-2)]"}`} role="status">
      {text}
      {canRetry && state.status !== "pending" && state.tags.length > 0 ? (
        <button type="button" className="underline" onClick={() => void retry()}>
          {fa["jobs.retry"]}
        </button>
      ) : null}
    </span>
  );
}
