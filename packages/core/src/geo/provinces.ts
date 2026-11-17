import provincesJson from "./provinces.json" with { type: "json" };
import { faNorm } from "../persian/normalize";

export const PROVINCE_CODES = [
  "ABZ",
  "ADL",
  "EAZ",
  "WAZ",
  "BHR",
  "CHB",
  "FRS",
  "GIL",
  "GLS",
  "HDN",
  "HRZ",
  "ILM",
  "ESF",
  "KRN",
  "KRH",
  "KHZ",
  "KBD",
  "KRD",
  "LRS",
  "MKZ",
  "MZN",
  "GZN",
  "QHM",
  "SMN",
  "SBN",
  "THR",
  "YZD",
  "ZJN",
  "NKH",
  "RKH",
  "SKH",
] as const;
export type ProvinceCode = (typeof PROVINCE_CODES)[number];

export type Province = { code: ProvinceCode; name: string; cities: readonly string[] };

export const PROVINCES: readonly Province[] = provincesJson as readonly Province[];

export type EtaZone = "tehran" | "neighbours" | "far";

export const ETA_ZONES: Record<EtaZone, readonly ProvinceCode[]> = {
  tehran: ["THR"],
  neighbours: ["ABZ", "MZN", "SMN", "QHM", "MKZ", "GZN"],
  far: [
    "ADL",
    "EAZ",
    "WAZ",
    "BHR",
    "CHB",
    "FRS",
    "GIL",
    "GLS",
    "HDN",
    "HRZ",
    "ILM",
    "ESF",
    "KRN",
    "KRH",
    "KHZ",
    "KBD",
    "KRD",
    "LRS",
    "SBN",
    "YZD",
    "ZJN",
    "NKH",
    "RKH",
    "SKH",
  ],
};

export const ETA_DAYS: Record<EtaZone, { min: number; max: number }> = {
  tehran: { min: 1, max: 3 },
  neighbours: { min: 2, max: 4 },
  far: { min: 4, max: 7 },
};

// ---------------------------------------------------------------- indexes
// Code lookup is eager (plain data); every faNorm-based index is built lazily on first use so that
// importing this module never runs Persian normalization (keeps import side-effect free and cheap).
const BY_CODE: ReadonlyMap<string, Province> = new Map(PROVINCES.map((p) => [p.code, p]));

let nameIndex: Map<string, Province> | null = null;
function namesByNorm(): Map<string, Province> {
  if (nameIndex === null) {
    nameIndex = new Map();
    for (const p of PROVINCES) nameIndex.set(faNorm(p.name), p);
  }
  return nameIndex;
}

const cityIndexes = new Map<string, Map<string, string>>();
function citiesByNorm(code: ProvinceCode): Map<string, string> {
  const cached = cityIndexes.get(code);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const city of listCities(code)) {
    const key = faNorm(city);
    if (key !== "" && !index.has(key)) index.set(key, city);
  }
  cityIndexes.set(code, index);
  return index;
}

let zoneOfCode: Map<string, EtaZone> | null = null;
function zones(): Map<string, EtaZone> {
  if (zoneOfCode === null) {
    zoneOfCode = new Map();
    for (const zone of Object.keys(ETA_ZONES) as EtaZone[]) {
      for (const code of ETA_ZONES[zone]) zoneOfCode.set(code, zone);
    }
  }
  return zoneOfCode;
}

let provinceList: readonly { code: ProvinceCode; name: string }[] | null = null;

// ---------------------------------------------------------------- lookups
export function getProvince(code: string): Province | null {
  if (typeof code !== "string") return null;
  return BY_CODE.get(code) ?? null;
}

export function findProvinceByName(name: string): Province | null {
  if (typeof name !== "string") return null;
  const byCode = getProvince(name.trim());
  if (byCode) return byCode;
  const key = faNorm(name);
  if (key === "") return null;
  return namesByNorm().get(key) ?? null;
}

export function listProvinces(): readonly { code: ProvinceCode; name: string }[] {
  if (provinceList === null) provinceList = PROVINCES.map((p) => ({ code: p.code, name: p.name }));
  return provinceList;
}

export function listCities(code: ProvinceCode): readonly string[] {
  return getProvince(code)?.cities ?? [];
}

export function cityExists(code: ProvinceCode, city: string): boolean {
  return canonicalCity(code, city) !== null;
}

export function canonicalCity(code: ProvinceCode, city: string): string | null {
  if (typeof city !== "string" || !BY_CODE.has(code)) return null;
  const key = faNorm(city);
  if (key === "") return null;
  return citiesByNorm(code).get(key) ?? null;
}

// DECISION: an unknown code (the type is compile-time only; addresses arrive over the wire) falls
// back to the slowest zone - a late promise is safer than a broken one.
export function etaZone(code: ProvinceCode): EtaZone {
  return zones().get(code) ?? "far";
}

export function etaDays(code: ProvinceCode): { min: number; max: number } {
  return ETA_DAYS[etaZone(code)];
}

export function isProvinceCode(s: string): s is ProvinceCode {
  return typeof s === "string" && (PROVINCE_CODES as readonly string[]).includes(s);
}
