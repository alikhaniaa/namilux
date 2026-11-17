"use client";
import { SORT_KEYS, plpUrl } from "@namilux/core/client";
import type { PlpState, SortKey } from "@namilux/core/client";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

const LABEL: Record<SortKey, FaKey> = {
  recommended: "plp.sort.recommended",
  price_asc: "plp.sort.price_asc",
  price_desc: "plp.sort.price_desc",
  newest: "plp.sort.newest",
  discount: "plp.sort.discount",
  bestselling: "plp.sort.bestselling",
};

// the spec: the sheet is the phone affordance, the popover the desktop one. The breakpoint is
// the `md` token (768 px) of the spec - the first width where the toolbar has room for a panel.
const DESKTOP = "(min-width: 768px)";
const subscribeDesktop = (onChange: () => void): (() => void) => {
  const mq = matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
  };
};
const getDesktop = (): boolean => matchMedia(DESKTOP).matches;
// DECISION: the server snapshot is `false` - 90 % of the traffic is a phone, so the markup that
// hydrates first is the sheet's; a desktop reader flips to the popover on the same tick.
const getServerDesktop = (): boolean => false;

export function SortMenu({ state, basePath }: { state: PlpState; basePath: string }): React.ReactNode {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const current: SortKey = state.sort ?? "recommended";
  const close = (): void => {
    setOpen(false);
  };

  // F-008/F-009: every option is a real URL, so a sorted listing is shareable and crawlable and the
  // server does the sorting. Changing the sort resets `page` (page 1 is dropped by plpUrl).
  // DECISION: the rows LOOK like radios (the check marks the current one) but they are links, so the
  // selected state travels as `aria-current` - `aria-checked` is not valid on a link.
  const list = (
    <ul>
      {SORT_KEYS.map((key) => (
        <li key={key}>
          <Link
            href={plpUrl(basePath, { ...state, sort: key, page: 1 })}
            aria-current={key === current ? "true" : undefined}
            onClick={close}
            scroll={false}
            className="t-body flex min-h-[44px] w-full items-center justify-between gap-4 py-2 text-start"
          >
            {t(LABEL[key])}
            {key === current ? <Icon name="check" size={20} /> : null}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t("plp.sort")}
        {/* The chosen sort is worth the width only where there is width (the spec draws
            «[مرتب‌سازی ⌄]» on the phone). */}
        <span className="hidden text-ink-3 md:inline">{t(LABEL[current])}</span>
        <Icon name="chevron-s" size={16} />
      </button>

      {desktop ? (
        <Popover open={open} onClose={close} anchor={anchor} label={t("plp.sort")}>
          <div className="min-w-[220px] px-4 py-2">{list}</div>
        </Popover>
      ) : (
        <Sheet open={open} onClose={close} title={t("plp.sort")}>
          {list}
        </Sheet>
      )}
    </>
  );
}
