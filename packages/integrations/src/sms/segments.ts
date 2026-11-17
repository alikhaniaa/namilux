export const MAX_TEMPLATE_SEGMENTS = 2;

// Basic GSM 03.38 alphabet + the common extension chars. Persian text falls outside it → UCS-2.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";
const GSM7_SET = new Set([...GSM7_BASIC, ...GSM7_EXT]);

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_SET.has(ch)) return false;
  }
  return true;
}

export function segmentsFor(text: string): number {
  // length in UTF-16 code units: emoji (surrogate pair) count as 2, ZWNJ/Persian digits as 1
  const len = text.length;
  if (isGsm7(text)) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
