"use client";
import { normalizePlpState, parsePlpState, plpUrl } from "@namilux/core/client";
import type { PlpState } from "@namilux/core/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/** url/plp-state rules: "changing any filter resets `page`". */
const FILTER_KEYS = ["brand", "collection", "color", "priceMin", "priceMax", "avail", "attr"] as const;

/** A sort or density change must not throw the reader back to the top of the listing. */
const KEEP_SCROLL_KEYS: readonly string[] = ["sort", "density"];

/**
 * DECISION: a patch REPLACES a group, it does not merge into it - `{ brand: ["smeg"] }` is the new
 * brand list. Clearing a group is `{ brand: [] }` (normalizePlpState drops the empty array), because
 * `exactOptionalPropertyTypes` makes an explicit `{ brand: undefined }` unexpressible in
 * `Partial<PlpState>`. Everything else (dedupe, collation, defaults, clamps) is normalizePlpState's
 * job, so a hook-built URL and a server-parsed one are the same string.
 */
function merge(state: PlpState, patch: Partial<PlpState>): PlpState {
  const next: PlpState = { ...state, ...patch };
  const touchesFilter = FILTER_KEYS.some((key) => Object.hasOwn(patch, key));
  if (touchesFilter && !Object.hasOwn(patch, "page")) delete next.page;
  return normalizePlpState(next);
}

export function usePlpState(basePath: string): {
  state: PlpState;
  href: (patch: Partial<PlpState>) => string;
  push: (patch: Partial<PlpState>) => void;
} {
  const router = useRouter();
  // The URL is the single source of truth for a listing (F-008): the hook reads it, it never keeps
  // a shadow copy that could drift from what the server rendered.
  const searchParams = useSearchParams();
  const state = useMemo(
    // A fresh URLSearchParams: `useSearchParams` hands back a read-only view and core takes the
    // standard type.
    () => parsePlpState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const href = useCallback(
    (patch: Partial<PlpState>): string => plpUrl(basePath, merge(state, patch)),
    [basePath, state],
  );

  const push = useCallback(
    (patch: Partial<PlpState>): void => {
      // An empty patch (the sheet's «اعمال») also keeps the scroll position: nothing above the grid moved.
      const keepScroll = Object.keys(patch).every((key) => KEEP_SCROLL_KEYS.includes(key));
      router.push(href(patch), { scroll: !keepScroll });
    },
    [href, router],
  );

  return { state, href, push };
}
