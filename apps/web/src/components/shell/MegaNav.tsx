"use client";
import type { NavData } from "@namilux/core";
import { faInt, plpUrl } from "@namilux/core/client";
import type { ImageRef } from "@namilux/core/client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

const UNDER_MILLIONS = 50;
const CHILDREN_SHOWN = 6;

type Preview = { name: string; count: number; href: string; image: ImageRef | null; mark?: boolean };

export function MegaNav({ nav, open, onClose }: { nav: NavData; open?: boolean; onClose?: () => void }): React.ReactNode {
  const [selfOpen, setSelfOpen] = useState(false);
  // Whether the panel was opened by the keyboard/click rather than by the pointer merely passing
  // over the trigger. Only then is focus moved inside - hovering must never steal it, and opening
  // on `focus` used to make the trigger a tab trap (you could not reach the links after it).
  const [byIntent, setByIntent] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : selfOpen;
  const close = (): void => {
    if (controlled) onClose?.();
    else setSelfOpen(false);
  };
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (controlled || byIntent) panel?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const active = document.activeElement;
      if (!(active instanceof HTMLAnchorElement) || panel === null || !panel.contains(active)) return;
      const column = active.closest("ul");
      if (column === null) return;
      const links = Array.from(column.querySelectorAll<HTMLAnchorElement>("a"));
      const i = links.indexOf(active);
      const next = links[e.key === "ArrowDown" ? i + 1 : i - 1];
      if (next !== undefined) {
        e.preventDefault();
        next.focus();
      }
    };
    // A click anywhere outside the trigger + panel closes it (a hover-opened panel used to stay).
    const onPointer = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root === null || !(e.target instanceof Node) || root.contains(e.target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` is stable per render mode; re-binding on every render would thrash the listener
  }, [isOpen]);

  // The preview: whatever the pointer is on; the first group with a cover until then.
  const firstGroup = nav.collections.find((c) => c.image !== null) ?? null;
  const shown: Preview | null =
    preview ?? (firstGroup === null ? null : { name: firstGroup.name, count: firstGroup.count, href: firstGroup.href, image: firstGroup.image });

  const byNeed: { href: string; label: string }[] = [
    { href: "/gifts/", label: t("nav.gifts") },
    { href: plpUrl("/shop/", { priceMax: UNDER_MILLIONS * 1_000_000 }), label: t("nav.byNeed.under", { n: UNDER_MILLIONS }) },
    { href: "/new/", label: t("nav.new") },
    { href: "/discount/", label: t("nav.sale") },
  ];

  return (
    <div className="mega-root" ref={rootRef} onMouseLeave={controlled ? undefined : () => setSelfOpen(false)}>
      {controlled ? null : (
        <button
          ref={triggerRef}
          type="button"
          className="nav-link nav-link--mega"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => {
            setByIntent(true);
            setSelfOpen((was) => !was);
          }}
          onMouseEnter={() => {
            setByIntent(false);
            setSelfOpen(true);
          }}
        >
          {t("nav.categories")}
          <Icon name="chevron-s" size={16} />
        </button>
      )}
      {isOpen ? (
        <div
          id={panelId}
          ref={panelRef}
          className="mega-panel anim-fade"
        >
          <div className="mega-panel__grid">
            {/* 1 · the categorisation: groups with their sub-collections */}
            <div>
              <p className="mega-panel__title">{t("nav.collections")}</p>
              <div className="mega-groups">
                {nav.collections.map((group) => {
                  const kids = group.children.slice(0, CHILDREN_SHOWN);
                  const rest = group.children.length - kids.length;
                  const enter = (): void => setPreview({ name: group.name, count: group.count, href: group.href, image: group.image });
                  return (
                    <div key={group.slug} className="mega-group" onMouseEnter={enter} onFocus={enter}>
                      <Link href={group.href} className="mega-group__name" onClick={close}>
                        {group.name}
                      </Link>
                      <ul>
                        {kids.map((child) => (
                          <li key={child.slug}>
                            <Link href={child.href} onClick={close}>
                              <span>{child.name}</span>
                              <span className="n">{faInt(child.count)}</span>
                            </Link>
                          </li>
                        ))}
                        {rest > 0 ? (
                          <li>
                            <Link href={group.href} className="mega-group__more" onClick={close}>
                              {t("nav.more", { n: rest })}
                            </Link>
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2 · brands */}
            <div>
              <p className="mega-panel__title">{t("nav.brands")}</p>
              <ul className="mega-brands">
                {nav.brands.map((b) => {
                  const enter = (): void => setPreview({ name: b.name, count: b.count, href: b.href, image: b.image, mark: true });
                  return (
                    <li key={b.slug}>
                      <Link href={b.href} onMouseEnter={enter} onFocus={enter} onClick={close}>
                        <span>
                          {/* the company's mark (brands.logo_media_id, 3 Sep 2026) */}
                          {b.image === null ? null : (
                            <span className="logo-well mega-brand__mark">
                              <Img image={b.image} slot="thumb" alt="" />
                            </span>
                          )}
                          {b.name}
                          <bdi>{b.nameEn}</bdi>
                        </span>
                        <span className="n">{faInt(b.count)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* 3 · the preview follows the pointer */}
            {shown === null ? (
              <div className="mega-preview" aria-hidden="true" />
            ) : (
              <Link href={shown.href} className={shown.mark === true ? "mega-preview mega-preview--mark plate" : "mega-preview plate"} onClick={close}>
                {shown.image === null ? null : <Img key={shown.image.key} image={shown.image} slot="cover" alt="" sizes="300px" />}
                <span className="mega-preview__caption">
                  <b>{shown.name}</b>
                  <span>{t("plp.count", { n: shown.count })}</span>
                </span>
              </Link>
            )}
          </div>

          {/* 4 · by need */}
          <div className="mega-panel__foot">
            <span className="t-xs text-ink-3">{t("nav.byNeed")}</span>
            {byNeed.map((n) => (
              <Link key={n.href} href={n.href} className="chip" onClick={close}>
                {n.label}
              </Link>
            ))}
            <Link href="/shop/" className="chip" onClick={close}>
              {t("nav.all")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
