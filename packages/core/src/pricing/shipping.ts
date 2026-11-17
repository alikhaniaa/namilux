// DECISION (M0 step 3): ShippingKind is declared once in ../constants and ShippingRate / ShippingMethod /
// ShippingOption once in ../types. This module re-exports the canonical declarations.
import type { ShippingKind } from "../constants";
import { findProvinceByName, isProvinceCode } from "../geo/provinces";
import type { ProvinceCode } from "../geo/provinces";
import type { ShippingMethod, ShippingOption, ShippingRate } from "../types";

export type { ShippingKind, ShippingMethod, ShippingOption, ShippingRate };

export const TEHRAN = "THR";
export const TEHRAN_NEIGHBOURS: readonly string[] = ["ABZ", "QHM", "MKZ", "SMN", "MZN", "GZN"];
export const PROVINCE_ETA_BANDS = {
  tehran: { min: 1, max: 3 },
  neighbour: { min: 2, max: 4 },
  far: { min: 4, max: 7 },
} as const;

export function provinceCode(input: string): string | null {
  const s = (input ?? "").trim();
  if (s === "") return null;
  const upper = s.toUpperCase();
  if (isProvinceCode(upper)) return upper;
  return findProvinceByName(s)?.code ?? null;
}

function bandFor(code: string): { min: number; max: number } {
  if (code === TEHRAN) return PROVINCE_ETA_BANDS.tehran;
  if (TEHRAN_NEIGHBOURS.includes(code)) return PROVINCE_ETA_BANDS.neighbour;
  return PROVINCE_ETA_BANDS.far;
}

export function etaForProvince(method: ShippingMethod, province: string): { min: number; max: number } {
  if (method.kind === "flat" || method.kind === "pickup") {
    return { min: method.etaMinDays, max: method.etaMaxDays };
  }
  const code = provinceCode(province) ?? TEHRAN;
  const band = bandFor(code);
  const min = Math.max(band.min, method.etaMinDays);
  const max = Math.min(band.max, method.etaMaxDays);
  if (min > max) return { min: method.etaMinDays, max: method.etaMaxDays };
  return { min, max };
}

/** Cost for one method at a subtotal; null → the method does not apply and is skipped. */
function costOf(method: ShippingMethod, code: ProvinceCode, subtotal: number): number | null {
  const { rate } = method;
  const freeByThreshold = rate.freeAbove !== undefined && subtotal >= rate.freeAbove;
  switch (method.kind) {
    case "free":
    case "pickup":
      return 0;
    case "flat":
      return freeByThreshold ? 0 : rate.flat ?? 0;
    case "by_province": {
      const base = rate.byProvince?.[code] ?? rate.flat;
      if (base === undefined) return null;
      return freeByThreshold ? 0 : base;
    }
    default:
      return null;
  }
}

export function shippingOptions(methods: ShippingMethod[], province: string, subtotal: number): ShippingOption[] {
  const code = (provinceCode(province) ?? TEHRAN) as ProvinceCode;
  const rows: { sort: number; option: ShippingOption }[] = [];
  for (const method of methods) {
    if (!method.isActive) continue;
    if (method.provinces !== null && !method.provinces.includes(code)) continue;
    const cost = costOf(method, code, subtotal);
    if (cost === null) continue;
    const eta = etaForProvince(method, code);
    rows.push({ sort: method.sort, option: { key: method.key, name: method.name, cost, etaMin: eta.min, etaMax: eta.max } });
  }
  rows.sort(
    (a, b) =>
      a.sort - b.sort ||
      a.option.cost - b.option.cost ||
      (a.option.key < b.option.key ? -1 : a.option.key > b.option.key ? 1 : 0),
  );
  return rows.map((r) => r.option);
}

export function cheapestOption(options: ShippingOption[]): ShippingOption | null {
  if (options.length === 0) return null;
  return options.reduce((best, o) => (o.cost < best.cost ? o : best));
}
