"use client";
import { plpUrl } from "@namilux/core/client";
import type { PlpState } from "@namilux/core/client";
import type { Facets, ImageRef } from "@namilux/core/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FilterRail } from "./FilterRail";
import { usePlpState } from "./usePlpState";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/i18n";

export function FilterSheet({
  open,
  onClose,
  state,
  facets,
  basePath,
  total,
  brandLogos,
  collectionCovers,
}: {
  open: boolean;
  // DECISION: spelled as a property, not the header's `onClose(): void` method shorthand - the type
  // is identical, and a method-shorthand prop trips `@typescript-eslint/unbound-method` when
  // destructured (the same choice ui/Sheet.tsx recorded).
  onClose: () => void;
  state: PlpState;
  facets: Facets;
  basePath: string;
  /** result count of the current state - the primary button says «نمایش ۲۶۱ کالا» */
  total?: number | undefined;
  brandLogos?: Record<string, ImageRef> | undefined;
  collectionCovers?: Record<string, ImageRef> | undefined;
}): React.ReactNode {
  const router = useRouter();
  const { href } = usePlpState(basePath);
  const [pending, startTransition] = useTransition();

  const target = plpUrl(basePath, state);
  // «پاک کردن» removes the FILTERS only: sort and density are not filters (core's
  // activeFilterCount does not count them) and a reader who chose «ارزان‌ترین» keeps it.
  const cleared: PlpState = {
    ...(state.sort === undefined ? {} : { sort: state.sort }),
    ...(state.density === undefined ? {} : { density: state.density }),
  };

  // DECISION: every facet control inside the sheet is a real link (F-008), so by the time «اعمال»
  // is pressed the URL usually already IS the applied state. The button therefore navigates only
  // when the live URL differs from `state` - both sides are serialized by plpUrl, so the comparison
  // is exact - and always closes; re-pushing an identical URL would only add a back-button trap.
  const apply = (): void => {
    if (href({}) !== target) {
      startTransition(() => {
        router.push(target);
      });
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("plp.filter")}
      size="full"
      footer={
        <div className="grid grid-cols-2 gap-3">
          {/* A reset is a URL as well, so it works with JS off and can be shared. */}
          <Link href={plpUrl(basePath, cleared)} className="btn btn--quiet">
            {t("plp.clear")}
          </Link>
          <Button variant="primary" block loading={pending} onClick={apply}>
            {total === undefined ? t("plp.apply") : total === 0 ? t("plp.filter.showNone") : t("plp.filter.show", { n: total })}
          </Button>
        </div>
      }
    >
      {/* the spec: while the next listing is in flight the panel is busy and dimmed; the grid
          behind it keeps its height (the vitrine reserves every slot) so nothing shifts. */}
      <div
        aria-busy={pending || undefined}
        className="filter-sheet__body transition-opacity"
        style={{ opacity: pending ? 0.4 : 1, transitionDuration: "var(--t-base)" }}
      >
        <FilterRail state={state} facets={facets} basePath={basePath} brandLogos={brandLogos} collectionCovers={collectionCovers} />
      </div>
    </Sheet>
  );
}
