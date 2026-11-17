import { faDigits } from "@namilux/core/client";

/**
 * Why an image sits in «کنترل کیفیت نرمال‌سازی», in Persian.
 *
 * The importer writes the reason as an English diagnostic with Latin digits
 * (`packages/seed/src/images/quarantine.ts` - "full-bleed frame (bbox 100%); coloured border (sat
 * 0.191)"), which is right for its own stdout/CSV report and wrong for the panel: it was printed
 * verbatim under every quarantined thumbnail, at the top of the page an operator opens to check
 * photography (found 9 Sep 2026). The stored string is left exactly as it is - it is the importer's
 * record - and translated here, at the edge that shows it.
 *
 * Anything unrecognised is passed through unchanged rather than swallowed: a reason the importer
 * gains tomorrow must still reach the operator, even in English.
 */

/** The Arabic decimal separator; `faInt`'s Persian thousands mark has no decimal twin in core. */
const FA_DECIMAL = "٫";

/** Latin digits → Persian, and the decimal point with them: "0.191" → "۰٫۱۹۱". */
function faNumber(value: string): string {
  return faDigits(value.replace(".", FA_DECIMAL));
}

const RULES: { re: RegExp; fa: (m: RegExpExecArray) => string }[] = [
  // trim() found no white margin - the photo is a full-bleed frame rather than a pack shot
  { re: /^full-bleed frame \(bbox ([\d.]+)%\)$/, fa: (m) => `قاب بدون حاشیه (٪${faNumber(m[1] ?? "")})`,
  },
  // the outer band of the image is coloured, so it will not sit on the site's white ground
  { re: /^coloured border \(sat ([\d.]+)\)$/, fa: (m) => `حاشیهٔ رنگی (${faNumber(m[1] ?? "")})` },
  // the source is far from square
  { re: /^aspect ([\d.]+)$/, fa: (m) => `نسبت ابعاد ${faNumber(m[1] ?? "")}` },
  { re: /^empty after trim$/, fa: () => "بعد از برش چیزی نماند" },
];

/** One clause of the stored reason. */
function clauseFa(clause: string): string {
  const c = clause.trim();
  for (const rule of RULES) {
    const m = rule.re.exec(c);
    if (m !== null) return rule.fa(m);
  }
  return c;
}

/** The whole stored reason ("a; b"), or `null` when there is none to show. */
export function quarantineReasonFa(reason: string | null | undefined): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed === "") return null;
  return trimmed
    .split(";")
    .map(clauseFa)
    .filter((s) => s !== "")
    .join("، ");
}
