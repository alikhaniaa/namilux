/**
 * The Suspense fallback of every listing route. The listing body streams in after the shell; with a
 * null fallback the footer is painted directly under the header on a slow phone and then jumps down
 * when the grid arrives (a layout shift of ~0.9 on /shop/). This placeholder reserves one viewport
 * of height so the footer stays below the fold until the real body replaces it.
 */
export function PlpFallback() {
  return <div className="plp-fallback" aria-hidden="true" />;
}
