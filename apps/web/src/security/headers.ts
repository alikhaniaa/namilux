// DECISION: the two pre-paint scripts of app/layout.tsx live here as data, with their SHA-256
// hashes in both CSP variants. The alternative - a per-request nonce - would force the root layout
// to read headers(), which under `cacheComponents` makes every route dynamic (Next reports
// "blocking-prerender-runtime"). A hash is static, works alongside 'strict-dynamic', and keeps the
// shell prerenderable. `headers.test.ts` re-derives both hashes from these strings, so the pair can
// never drift. the spec is otherwise unchanged.
export const THEME_SCRIPT =
  "try{var t=localStorage.getItem('nl.theme');" +
  "var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;" +
  "if(d)document.documentElement.classList.add('dark')}catch(e){}";
// The second script also stamps `data-hero-seen` when this session already played the vitrine
// reveal (KEYS.heroSeen - the literal is repeated here because the script is data, not a module).
// The decision has to be made before first paint: the reveal is server-rendered, and removing the
// class after hydration used to cut the running composited animation short (a visible snap and a
// spurious 0.012 layout shift on the scrim, measured on the live site).
export const STANDALONE_SCRIPT =
  "try{if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)" +
  "document.documentElement.setAttribute('data-standalone','1')}catch(e){}" +
  "try{if(sessionStorage.getItem('nl.hero.seen'))" +
  "document.documentElement.setAttribute('data-hero-seen','1')}catch(e){}";
export const INLINE_SCRIPT_HASHES = [
  "'sha256-WzsJJzZUrRnCDHn127W5pEeqNeRaVnQmh89AXu4R8n4='",
  "'sha256-vWEH6jDxPDRG5huA4oBM9W/EOevfnrMYM2vFntsYU0s='",
] as const;

export const SEAL_ORIGINS = ["https://trustseal.enamad.ir", "https://logo.samandehi.ir"] as const;
export const GATEWAY_FORM_ACTIONS = ["https://payment.zarinpal.com", "https://sandbox.zarinpal.com"] as const;
export const IMMUTABLE = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
export const NO_STORE = [{ key: "Cache-Control", value: "no-store" }];
export function csp(variant: "cached" | "nonce", nonce?: string, https = true): string {
  // The hashes go ONLY on the nonce variant. Adding a hash to a list that carries 'unsafe-inline'
  // makes the browser ignore 'unsafe-inline' entirely (CSP §"if either a hash or nonce value is
  // present") - which blocked React's own streaming bootstrap and left every Suspense boundary
  // sitting unopened in a <template>. Observed in the browser. The cached variant stays exactly as
  // the spec writes it; the nonce variant needs the hashes so the two pre-paint scripts of
  // app/layout.tsx still run on the personal routes.
  // DECISION (M8 browser check): React's development build needs eval() for its overlay; the flag
  // exists only under `next dev` (NODE_ENV=development) and is never emitted by a production build.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const script =
    variant === "nonce" && nonce
      ? `'nonce-${nonce}' 'strict-dynamic' ${INLINE_SCRIPT_HASHES.join(" ")}${devEval}`
      : `'self' 'unsafe-inline'${devEval}`;
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${SEAL_ORIGINS.join(" ")}`,
    "font-src 'self'", "connect-src 'self'", "media-src 'self'", "worker-src 'self'",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'",
    `form-action 'self' ${GATEWAY_FORM_ACTIONS.join(" ")}`,
    ...(https ? ["upgrade-insecure-requests"] : []),
    "report-to csp",
  ].join("; ");
}
export function securityHeaders(variant: "cached" | "nonce", nonce?: string, https = true): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: csp(variant, nonce, https) },
    { key: "Reporting-Endpoints", value: 'csp="/api/e?csp=1"' },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
