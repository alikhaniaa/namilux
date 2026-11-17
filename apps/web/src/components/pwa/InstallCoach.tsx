"use client";
import type { PwaCoachSetting } from "@namilux/core/client";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isInAppBrowser, isIos, isStandalone } from "./standalone";
import { Icon } from "@/components/ui/Icon";
import { KEYS, readJson, writeJson } from "@/lib/storage-keys";
import { t } from "@/i18n";

type CoachCtx = "inapp-android" | "inapp-ios" | "bip" | "ios-safari";
type CoachState = { v: 2; shows: number; snoozedUntil: number; done: boolean; ctx?: string };

type BipEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DWELL_MS = 25_000;
const MANUAL_AFTER_MS = 1500;
const DAY_MS = 86_400_000;
const PAGEVIEW_KEY = "nl.pv";
/** The badge the install sheet previews; the icon build owns the folder (tokens.json `brand`). */
const APP_ICON = `/icons/${tokens.brand.icons}/icon-192.png`;

const EMPTY: CoachState = { v: 2, shows: 0, snoozedUntil: 0, done: false };

function isCoachState(v: unknown): v is CoachState {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<CoachState>;
  return o.v === 2 && typeof o.shows === "number" && typeof o.snoozedUntil === "number" && typeof o.done === "boolean";
}

const readState = (): CoachState => readJson(KEYS.coach, isCoachState) ?? EMPTY;

/** Pure so the frequency rules can be tested without a browser (the header names that test). */
export function mayShow(state: CoachState, maxShows: number, now: number): boolean {
  return !state.done && state.shows < maxShows && now >= state.snoozedUntil;
}

function detectContext(ua: string): CoachCtx | null {
  const inApp = isInAppBrowser(ua);
  const ios = isIos(ua);
  const android = /Android/i.test(ua);
  if (inApp && android) return "inapp-android";
  if (inApp && ios) return "inapp-ios";
  // Safari on iOS only: Chrome/Firefox/Edge on iOS cannot add to the home screen.
  if (ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return "ios-safari";
  return null;
}

/** The iOS share glyph (a box with an arrow leaving it), drawn to the icon set's 1.5 px / 24 grid. */
function ShareGlyph(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15.5V4.5m0 0L8.5 8M12 4.5 15.5 8" />
      <path d="M6.5 11.5H5.5v9h13v-9h-1" />
    </svg>
  );
}

export function InstallCoach({ copy }: { copy: PwaCoachSetting }): React.ReactNode {
  const pathname = usePathname();
  const [ctx, setCtx] = useState<CoachCtx | null>(null);
  const [bip, setBip] = useState<BipEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      const s = readState();
      if (!s.done) writeJson(KEYS.coach, { ...s, done: true });
      return undefined;
    }
    if (!mayShow(readState(), copy.maxShows, Date.now())) return undefined;
    // the spec coaches phones (Instagram webview, Android prompt, iOS A2HS).
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return undefined;

    const detected = detectContext(navigator.userAgent);
    if (detected !== null) setCtx(detected);

    // Android Chrome/Edge/Samsung: the browser tells us it is installable - that is the only
    // signal worth acting on, so nothing is guessed from the UA on that branch.
    const onBip = (e: Event): void => {
      e.preventDefault();
      setBip(e as BipEvent);
      setCtx("bip");
    };
    addEventListener("beforeinstallprompt", onBip);

    // the spec: second pageview OR 25 s dwell - quiet, never an ambush on arrival.
    const timer = setTimeout(() => setVisible(true), DWELL_MS);
    try {
      if (sessionStorage.getItem(PAGEVIEW_KEY) === "1") setVisible(true);
      sessionStorage.setItem(PAGEVIEW_KEY, "1");
    } catch {
      /* private mode: the dwell timer is the only trigger */
    }

    return () => {
      removeEventListener("beforeinstallprompt", onBip);
      clearTimeout(timer);
    };
  }, [copy.maxShows]);

  // Never during checkout.
  if (ctx === null || !visible || pathname.startsWith("/billing")) return null;

  const snooze = (): void => {
    const s = readState();
    writeJson(KEYS.coach, { ...s, v: 2, shows: s.shows + 1, snoozedUntil: Date.now() + copy.snoozeDays * DAY_MS, ctx });
    setVisible(false);
  };

  const escapeInApp = (): void => {
    const here = `${location.host}${location.pathname}${location.search}`;
    if (ctx === "inapp-android") {
      location.href = `intent://${here}#Intent;scheme=https;package=com.android.chrome;end`;
    } else {
      open(`x-safari-https://${here}`, "_blank");
    }
    // If the escape did nothing we are still here - show the manual steps instead of failing quietly.
    setTimeout(() => setManual(true), MANUAL_AFTER_MS);
  };

  const install = (): void => {
    if (bip === null) return;
    void bip.prompt().then(async () => {
      const choice = await bip.userChoice.catch(() => ({ outcome: "dismissed" }));
      const s = readState();
      if (choice.outcome === "accepted") writeJson(KEYS.coach, { ...s, v: 2, done: true });
      else snooze();
      setVisible(false);
    });
  };

  const title = ctx === "bip" ? copy.bipTitle : ctx === "ios-safari" ? copy.iosTitle : copy.inappTitle;

  return (
    // Above the tab bar and inside the safe area, so it never covers the primary navigation.
    <div className="install-coach safe-b" role="dialog" aria-label={title}>
      <div className="install-coach__sheet anim-sheet">
        <div className="install-coach__head">
          <img src={APP_ICON} alt="" width={48} height={48} className="install-coach__icon" />
          <div className="min-w-0 grid gap-0.5">
            <p className="t-sm font-semibold">{manual ? t("pwa.coach.inapp.manual") : title}</p>
            {manual ? null : <p className="t-xs text-ink-3">{ctx === "bip" ? t("pwa.coach.benefit") : ctx === "ios-safari" ? t("pwa.coach.benefit") : copy.inappBody}</p>}
          </div>
          <button type="button" onClick={snooze} aria-label={t("shell.close")} className="icon-btn -me-2 -mt-1 text-ink-3">
            <Icon name="close" size={16} />
          </button>
        </div>

        {ctx === "ios-safari" && !manual ? (
          <ol className="install-coach__steps">
            <li>
              <span className="install-coach__glyph">
                <ShareGlyph />
              </span>
              {t("pwa.coach.ios.step1")}
            </li>
            <li>
              <span className="install-coach__glyph">
                <Icon name="plus" size={16} />
              </span>
              {t("pwa.coach.ios.step2")}
            </li>
          </ol>
        ) : null}

        {manual ? null : (
          <div className="install-coach__actions">
            {ctx === "bip" ? (
              <button type="button" onClick={install} className="btn btn--primary">
                {t("pwa.coach.bip.cta")}
              </button>
            ) : null}
            {ctx === "inapp-android" || ctx === "inapp-ios" ? (
              <button type="button" onClick={escapeInApp} className="btn btn--primary">
                {t("pwa.coach.inapp.cta")}
              </button>
            ) : null}
            <button type="button" onClick={snooze} className="btn btn--quiet">
              {t("pwa.coach.later")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
