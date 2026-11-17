"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";
import { KEYS } from "@/lib/storage-keys";

type Density = 3 | 5;

const DENSITIES: readonly Density[] = [3, 5];
const ICON: Record<Density, IconName> = { 3: "grid-3", 5: "grid-5" };
const LABEL: Record<Density, FaKey> = { 3: "plp.density.3", 5: "plp.density.5" };
const DEFAULT_DENSITY: Density = 3;

function read(): Density {
  try {
    return localStorage.getItem(KEYS.density) === "5" ? 5 : DEFAULT_DENSITY;
  } catch {
    // private mode / blocked storage: the default column count still applies
    return DEFAULT_DENSITY;
  }
}

/**
 * DECISION: the choice is written as `--cols` on the vitrine itself and mirrored as
 * `data-density` on <html>. The header says "via a data attribute", but components.css reads
 * `repeat(var(--cols, 4), 1fr)` and adding a CSS rule is out of this file's scope - so the variable
 * is set directly (exactly what ProductGrid's own inline style does) and the attribute is kept as
 * the hook a stylesheet or an e2e test can read.
 */
function apply(density: Density): void {
  document.documentElement.dataset["density"] = String(density);
  for (const grid of document.querySelectorAll(".vitrine")) {
    if (grid instanceof HTMLElement) grid.style.setProperty("--cols", String(density));
  }
}

export function DensityToggle(): React.ReactNode {
  // The server renders the 3-column default (F-010 persists the choice in localStorage, not in a
  // cookie), so the first client render must agree with the markup; the stored value lands after
  // mount, when the grid can be re-flowed without a hydration mismatch.
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  useEffect(() => {
    setDensity(read());
  }, []);
  // No dependency array on purpose: a navigation re-renders ProductGrid, which rewrites the inline
  // `--cols` from the server's default - re-applying after every render keeps the chosen density.
  useEffect(() => {
    apply(density);
  });

  const choose = (next: Density): void => {
    setDensity(next);
    try {
      localStorage.setItem(KEYS.density, String(next));
    } catch {
      // storage unavailable - the flip below still applies for this page view
    }
  };

  return (
    <div className="flex">
      {DENSITIES.map((value) => (
        <button
          key={value}
          type="button"
          className="chip"
          aria-pressed={density === value}
          aria-label={t(LABEL[value])}
          onClick={() => {
            choose(value);
          }}
        >
          <Icon name={ICON[value]} size={20} />
        </button>
      ))}
    </div>
  );
}
