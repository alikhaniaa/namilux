export const PUBLIC = {
  buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
  siteOrigin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000",
} as const;
