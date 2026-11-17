"use client";
import type { PwaCoachSetting } from "@namilux/core/client";
import { Suspense, createContext, useContext, useEffect, useRef, useState } from "react";
import { PageviewBeacon } from "./PageviewBeacon";
import { InstallCoach } from "@/components/pwa/InstallCoach";
import { ToastHost } from "@/components/ui/Toast";
import { setCartSignedIn, syncWithServer } from "./cart-store";
import { syncTheme } from "./theme";
import { setWishlistSignedIn, syncWishlist } from "./wishlist-store";

type User = { id: string; firstName: string | null } | null;

const UserContext = createContext<User>(null);

/**
 * DECISION: the storefront layout is statically cached (M1 Lighthouse budgets), so it cannot read the
 * session cookie server-side without opting the whole tree out of prerendering. Instead the session
 * is hydrated on the client: `user` arrives null and a one-shot `/api/me/` bootstrap discovers it, so
 * pages stay static while the header/account/badge reflect the real login.
 */
export function Providers({
  user: initialUser,
  coach,
  children,
}: {
  user: User;
  coach: PwaCoachSetting;
  children: React.ReactNode;
}): React.ReactNode {
  const [user, setUser] = useState<User>(initialUser);
  const mergedFor = useRef<string | null>(null);
  const bootstrapped = useRef(false);

  // The saved theme survives hydration (a not-found render re-writes <html>'s attributes and would
  // otherwise drop the pre-paint `dark` class - see theme.ts syncTheme).
  useEffect(() => {
    syncTheme();
  }, []);

  // One-shot client bootstrap: learn whether a session exists (the cookie is HttpOnly).
  useEffect(() => {
    if (initialUser !== null || bootstrapped.current) return;
    bootstrapped.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/me/", { headers: { accept: "application/json" } });
        // Always drain the body, even on the guest's 401: an unread response keeps the request "in
        // flight" in Chromium until GC reaches the stream - DevTools shows it pending and Playwright /
        // Lighthouse never observe network idle on any page.
        const body = (await res.json().catch(() => null)) as { ok: boolean; data?: { user?: { customerId: string; firstName: string | null } } } | null;
        if (!res.ok || body === null) return;
        const u = body.data?.user;
        if (!cancelled && body.ok && u !== undefined) setUser({ id: u.customerId, firstName: u.firstName });
      } catch {
        /* offline / not signed in - stay a guest */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialUser]);

  useEffect(() => {
    const signedIn = user !== null;
    setCartSignedIn(signedIn);
    setWishlistSignedIn(signedIn);
    if (!signedIn) {
      mergedFor.current = null;
      return;
    }
    // Merge exactly once per session id - a navigation must not re-merge and double the quantities.
    if (mergedFor.current === user.id) return;
    mergedFor.current = user.id;
    void syncWithServer("merge");
    void syncWishlist("merge");
  }, [user]);

  return (
    <UserContext.Provider value={user}>
      {children}
      <ToastHost />
      {/* Reads the pathname: behind a boundary so it cannot block a prerender (see layout). */}
      <Suspense fallback={null}>
        <InstallCoach copy={coach} />
      </Suspense>
      {/* The pageview beacon reads the URL too; same boundary rule as InstallCoach. */}
      <Suspense fallback={null}>
        <PageviewBeacon />
      </Suspense>
    </UserContext.Provider>
  );
}

export function useUser(): User {
  return useContext(UserContext);
}
