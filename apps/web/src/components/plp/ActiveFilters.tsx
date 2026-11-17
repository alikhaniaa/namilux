import { activeFilterChips, formatToman, plpUrl } from "@namilux/core/client";
import type { Facets, PlpState } from "@namilux/core/client";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

const AVAIL_LABEL: Record<string, FaKey> = { in: "plp.avail.in", sale: "plp.avail.sale", ready: "plp.avail.ready" };

export function ActiveFilters({
  state,
  facets,
  basePath,
}: {
  state: PlpState;
  facets: Facets;
  basePath: string;
}): React.ReactNode {
  // The chips (and the state each one removes) are computed in core, so the URL grammar has exactly
  // one owner and a chip can never produce a URL the parser would read back differently.
  const chips = activeFilterChips(state, facets);
  // DECISION: the band's own layout classes live here, not on a wrapper in PlpPage. A wrapper there
  // still paints its `.tier-block` padding when this returns null, which left ~48 px of dead space
  // between the toolbar and the vitrine on an unfiltered listing.
  if (chips.length === 0) return null;

  const labelOf = (chip: (typeof chips)[number]): string => {
    if (chip.group === "avail") {
      const key = AVAIL_LABEL[chip.value];
      return key === undefined ? chip.label : t(key);
    }
    if (chip.group === "price") {
      const parts: string[] = [];
      if (state.priceMin !== undefined) parts.push(`${t("plp.price.min")} ${formatToman(state.priceMin)}`);
      if (state.priceMax !== undefined) parts.push(`${t("plp.price.max")} ${formatToman(state.priceMax)}`);
      parts.push(t("product.price.unit"));
      return parts.join(" ");
    }
    return chip.label;
  };

  return (
    <div className="wrap plp-active flex flex-wrap items-center gap-2">
      {chips.map((chip) => {
        const label = labelOf(chip);
        return (
          <Link
            key={`${chip.group}:${chip.key ?? ""}:${chip.value}`}
            href={plpUrl(basePath, chip.removeState)}
            className="chip"
            aria-label={`${t("plp.clear")}، ${label}`}
          >
            {label}
            <Icon name="close" size={16} />
          </Link>
        );
      })}
      <Link href={plpUrl(basePath, {})} className="link-under t-sm">
        {t("plp.clearAll")}
      </Link>
    </div>
  );
}
