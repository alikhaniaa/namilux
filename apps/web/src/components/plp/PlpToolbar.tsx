"use client";
import { activeFilterCount } from "@namilux/core/client";
import type { Facets, ImageRef, PlpState } from "@namilux/core/client";
import { useState } from "react";
import { DensityToggle } from "./DensityToggle";
import { FilterSheet } from "./FilterSheet";
import { SortMenu } from "./SortMenu";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

export function PlpToolbar({
  state,
  facets,
  basePath,
  total,
  densityToggle = false,
  brandLogos,
  collectionCovers,
}: {
  state: PlpState;
  facets: Facets;
  basePath: string;
  total: number;
  // DECISION (added, optional): `flags.densityToggle` is a SETTING and settings are server-side
  // only - a client island has no channel to read one. The flag therefore arrives as an optional
  // prop from the server PlpPage; every prop the header lists keeps its name and meaning, and a
  // caller that omits it gets the flag's own default (false).
  densityToggle?: boolean;
  /** brand slug → mark, for the brand facet tiles (3 Sep 2026 filter sheet) */
  brandLogos?: Record<string, ImageRef>;
  /** collection slug → cover, for the collection facet tiles */
  collectionCovers?: Record<string, ImageRef>;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  // sort/page/density are not filters; the count is what the shopper narrowed down.
  const count = activeFilterCount(state);

  return (
    <div className="flex w-full items-center justify-between gap-3">
      {/* v2 §9.2: count and filters at the start, sort and density at the end. */}
      <div className="flex items-center gap-3">
        {/* The rail is always visible from lg up, so the sheet trigger is a phone/tablet control. */}
        <button
          type="button"
          className="chip lg:hidden"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
          }}
        >
          <Icon name="filter" size={16} />
          {count === 0 ? t("plp.filter") : t("plp.filter.withCount", { n: count })}
        </button>
        <p className="t-sm text-ink-3">{t("plp.count", { n: total })}</p>
      </div>

      <div className="flex items-center gap-2">
        {/* F-010 is desktop-only and the column count itself only changes at 1180 px. */}
        {densityToggle ? (
          <div className="hidden xl:flex">
            <DensityToggle />
          </div>
        ) : null}
        <SortMenu state={state} basePath={basePath} />
      </div>

      <FilterSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        state={state}
        facets={facets}
        basePath={basePath}
        total={total}
        brandLogos={brandLogos}
        collectionCovers={collectionCovers}
      />
    </div>
  );
}
