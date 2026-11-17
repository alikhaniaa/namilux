import { Suspense } from "react";
import { Footer } from "@/components/shell/Footer";
import { RevealObserver } from "@/components/shell/RevealObserver";
import { Header } from "@/components/shell/Header";
import { env } from "@/env";
import { InstalmentBar } from "@/components/shell/InstalmentBar";
import { PromoBar } from "@/components/shell/PromoBar";
import { ScrollReset } from "@/components/shell/ScrollReset";
import { TabBar } from "@/components/shell/TabBar";
import { SwRegister } from "@/components/pwa/SwRegister";
import { UpdateToast } from "@/components/pwa/UpdateToast";
import { loadNav } from "@/server/loaders/nav";
import { loadSettings } from "@/server/loaders/settings";
// DECISION: "is this the homepage" is answered by a route-group sibling, not by reading the
// pathname here - this layout must stay free of request state so every page under it can be
// cached. `PromoBar` is a client island and hides itself when the message list is empty, and
// `app/(site)/page.tsx` is the only route that passes one.
export default async function SiteLayout({ children }: {
    children: React.ReactNode;
}) {
    const [nav, settings] = await Promise.all([loadNav(), loadSettings()]);
    return (<>
      <PromoBar messages={nav.promo} rotateSec={settings["promo.bar"].rotateSec}/>
      {/* The instalment announcement sits UNDER the owner's promo line and never inside it: the
            promo bar stays the admin's own surface, and a standing fact about the shop must not be
            able to push a time-bound message out of rotation. The channel is a fact about this
            process, so the strip costs one boolean and no request state. */}
      <InstalmentBar enabled={env.SNAPPPAY_ENABLED}/>
      <Header nav={nav} isHome={false} megaNav={settings.flags.megaNav} instagram={settings["store.social"].instagram}/>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <RevealObserver />
      <Footer menus={nav.menus} store={nav.footer.store} seals={nav.footer.seals} instagram={settings["store.social"].instagram}/>
      {/* DECISION: the URL-reading islands sit behind their own boundaries. `cacheComponents` treats
            usePathname()/useSearchParams() in a client component as runtime data, so an unwrapped one
            blocks the prerender of EVERY route under this layout (Next: blocking-prerender-client-hook).
            Each fallback is null because all three render nothing above the fold: the tab bar is
            `fixed` and brings its own spacer, and the two PWA islands render null by design. */}
      <Suspense fallback={null}>
        <TabBar />
        <ScrollReset />
      </Suspense>
      <Suspense fallback={null}>
        <SwRegister />
        <UpdateToast />
      </Suspense>
    </>);
}
