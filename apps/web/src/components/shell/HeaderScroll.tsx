"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const CONDENSE_AT = 120;
const SCROLLED_AT = 8;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href);
}

export function HeaderScroll(): null {
  const pathname = usePathname();

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-site-header]");
    if (header === null) return undefined;
    let ticking = false;
    const update = (): void => {
      ticking = false;
      const y = window.scrollY;
      header.toggleAttribute("data-scrolled", y > SCROLLED_AT);
      header.toggleAttribute("data-condensed", y > CONDENSE_AT);
    };
    const onScroll = (): void => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-site-header]");
    if (header === null) return;
    // A stale reveal attribute from an older build must not linger on the shell.
    header.removeAttribute("data-nav-revealed");
    for (const link of header.querySelectorAll<HTMLAnchorElement>("a.nav-link")) {
      const href = link.getAttribute("href") ?? "";
      if (isActive(pathname, href)) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }, [pathname]);

  return null;
}
