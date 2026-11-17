export function safeNext(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "/";
  if (raw.length > 2048) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // No whitespace, no C0/DEL control characters anywhere (header/URL injection, hidden redirects).
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return "/";
  }
  if (raw === "/login" || raw.startsWith("/login/") || raw.startsWith("/login?")) return "/";
  return raw;
}
