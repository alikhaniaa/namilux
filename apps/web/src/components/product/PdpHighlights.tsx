import { faDigits } from "@namilux/core/client";
import type { SpecGroup } from "@namilux/core/client";
import { Bdi } from "@/components/ui/Bdi";
import { t } from "@/i18n";

const MAX_VALUE_CHARS = 26;
const MIN_TILES = 2;

export function pickHighlights(specs: SpecGroup[], max: number): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const group of specs) {
    for (const row of group.rows) {
      const value = row.value.trim();
      const label = row.label.trim();
      if (value === "" || label === "" || value.length > MAX_VALUE_CHARS || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, value });
      if (out.length === max) return out;
    }
  }
  return out;
}

export function PdpHighlights({ specs, max = 4 }: { specs: SpecGroup[]; max?: number }): React.ReactNode {
  const tiles = pickHighlights(specs, max);
  if (tiles.length < MIN_TILES) return null;
  return (
    <section className="wrap pdp-section" aria-label={t("product.highlights")}>
      <ul className="pdp-highlights">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <span className="v">
              <Bdi text={faDigits(tile.value)} />
            </span>
            <span className="k">{tile.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
