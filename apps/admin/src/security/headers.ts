export function adminCsp(nonce: string, siteOrigin: string): string {
  return [
    "default-src 'self'",
    // DECISION (M8 browser check): React's development build needs eval() for its overlay; the flag exists only under `next dev` (NODE_ENV=development) and never in a production build.
    `script-src 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${siteOrigin}`,
    "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
    // DECISION: same rule as apps/web/src/security/headers.ts - the directive only when the deployment is
    // https (the spec: SITE_ORIGIN must be https in production). On plain-http dev, WebKit honours it
    // for localhost too (Chromium exempts localhost), upgrades every chunk to https://localhost:3100 and
    // the console never hydrates in Safari / the mobile-390 e2e project.
    ...(siteOrigin.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
export function adminHeaders(nonce: string, siteOrigin: string): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: adminCsp(nonce, siteOrigin) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" }, { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" },
    { key: "Cache-Control", value: "no-store" }, { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
