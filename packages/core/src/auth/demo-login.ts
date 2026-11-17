export function passwordOnlyDemoEnabled(source: Readonly<Record<string, string | undefined>>): boolean {
  return source.ADMIN_TOTP_DISABLED === "1" &&
    (source.APP_ENV === "dev" || source.APP_ENV === "staging") &&
    source.ADMIN_ORIGIN === "https://203.0.113.10:8100";
}
