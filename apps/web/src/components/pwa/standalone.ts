"use client";

const IN_APP_RE = /Instagram|FBAN|FBAV|FB_IAB/i;
const IOS_RE = /iPad|iPhone|iPod/i;

export function isStandalone(): boolean {
  try {
    if (matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* no matchMedia: fall through to the iOS flag */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function markStandalone(): void {
  if (isStandalone()) document.documentElement.setAttribute("data-standalone", "1");
}

export function goBack(fallback = "/"): void {
  // iOS standalone has no browser chrome, so a first-entry page must still offer a way out.
  if (history.length > 1) history.back();
  else location.assign(fallback);
}

export function setBadge(n: number): void {
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) void nav.setAppBadge?.(n);
    else void nav.clearAppBadge?.();
  } catch {
    /* unsupported or denied */
  }
}

export async function share(o: { title: string; url: string; text?: string }): Promise<"shared" | "copied" | "unsupported"> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share(o);
      return "shared";
    } catch (e) {
      // A cancelled share is a decision, not a failure - do not fall through to the clipboard.
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
    }
  }
  try {
    await navigator.clipboard.writeText(o.url);
    return "copied";
  } catch {
    return "unsupported";
  }
}

export function isInAppBrowser(ua: string): boolean {
  return IN_APP_RE.test(ua);
}

export function isIos(ua: string): boolean {
  return IOS_RE.test(ua);
}
