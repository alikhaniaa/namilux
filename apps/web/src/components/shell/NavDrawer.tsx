"use client";
import { ROUTES, faDigits, faInt, normalizePhone, searchUrl, whatsappUrl } from "@namilux/core/client";
import type { NavData } from "@namilux/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CompareControl } from "./CompareControl";
import { shopPhones } from "./contact";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";
import { useCart } from "@/components/state/cart-store";
import { useUser } from "@/components/state/providers";
import { useWishlist } from "@/components/state/wishlist-store";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

/** The shop's contacts shown near the end of the menu (from the settings, via the header). */
export type MenuContact = {
  whatsapp: string;
  phoneMobile: string;
  phoneLand: string;
  hoursNote: string;
  instagram: string;
};

const rise = (i: number): React.CSSProperties => ({ "--i": i } as React.CSSProperties);

/**
 * The mobile catalogue uses the same published groups and brands as desktop. A compact tile opens
 * its immediate children in place; account and support remain available below the shopping links.
 */
export function NavDrawer({
  nav,
  contact,
  open,
  onClose,
  labelled = false,
}: {
  nav: NavData;
  contact?: MenuContact;
  open?: boolean;
  onClose?: () => void;
  labelled?: boolean;
}): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(false);
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const childrenId = useId();
  const selected = nav.collections.find((group) => group.slug === expanded);
  const categoryRows = nav.collections.flatMap((_, i) => i % 2 === 0 ? [nav.collections.slice(i, i + 2)] : []);
  const isOpen = open ?? internalOpen;
  const close = (): void => {
    if (onClose === undefined) setInternalOpen(false);
    else onClose();
  };
  const user = useUser();
  const { count: cartCount } = useCart();
  const { count: wishCount } = useWishlist();

  const primary = nav.menus.drawer;
  const help = nav.menus.footer_help;
  const whatsapp = contact === undefined ? null : normalizePhone(contact.whatsapp);
  const phones = contact === undefined ? [] : shopPhones(contact);
  const instagram = contact === undefined ? "" : contact.instagram.trim().replace(/^@/, "");
  const hasContact = whatsapp !== null || phones.length > 0 || instagram !== "";
  const accountLabel =
    user === null ? t("shell.login") : user.firstName === null ? t("account.title") : t("account.greeting", { name: user.firstName });

  return (
    <>
      <button
        type="button"
        aria-label={t("a11y.openMenu")}
        aria-expanded={isOpen}
        className={labelled ? "labelled-ctl t-sm" : "icon-btn"}
        onClick={() => setInternalOpen(true)}
      >
        <Icon name="menu" size={labelled ? 20 : 24} />
        {labelled ? t("shell.menu") : null}
      </button>
      <Drawer open={isOpen} onClose={close} label={t("a11y.mainNav")} title={<Wordmark size="sm" />} className="drawer--catalog">
        {/* A link closes the drawer; the theme row and the contact buttons keep it open. */}
        <nav
          className="menu menu--catalog"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a") !== null) close();
          }}
        >
          <form action="/search/" method="get" role="search" className="menu__search" onSubmit={(event) => {
            event.preventDefault();
            const query = new FormData(event.currentTarget).get("q");
            if (typeof query !== "string" || query.trim() === "") return;
            close();
            router.push(searchUrl(query.trim()));
          }}>
            <label className="sr-only" htmlFor={`${childrenId}-search`}>{t("shell.search")}</label>
            <input id={`${childrenId}-search`} type="search" name="q" placeholder={t("shell.search.placeholder")} required autoComplete="off" />
            <button type="submit" className="icon-btn" aria-label={t("shell.search")}><Icon name="search" size={20} /></button>
          </form>

          {nav.collections.length === 0 ? null : (
            <section aria-labelledby={`${childrenId}-title`}>
              <div className="menu__section-head">
                <h2 id={`${childrenId}-title`}>{t("nav.categories")}</h2>
                <Link href={ROUTES.shop}>{t("nav.all")}</Link>
              </div>
              <div className="menu__categories">
                {categoryRows.map((row) => <div className="menu__category-row" key={row[0]?.slug}>
                {row.map((group) => {
                  const content = <>
                    <span className="menu__category-image" aria-hidden="true">
                      {group.image === null ? <Icon name="shop" size={24} /> : <Img image={group.image} slot="thumb" alt="" sizes="64px" />}
                    </span>
                    <span className="menu__category-name">{group.name}<Icon name={selected?.slug === group.slug ? "minus" : group.children.length > 0 ? "plus" : "arrow-e"} size={16} /></span>
                  </>;
                  return group.children.length === 0 ? (
                    <Link key={group.slug} href={group.href} className="menu__category">{content}</Link>
                  ) : (
                    <button key={group.slug} type="button" className="menu__category" aria-expanded={selected?.slug === group.slug} aria-controls={selected?.slug === group.slug ? childrenId : undefined} onClick={() => setExpanded((current) => current === group.slug ? null : group.slug)}>{content}</button>
                  );
                })}
                {selected === undefined || !row.some((group) => group.slug === selected.slug) ? null : (
                  <div id={childrenId} className="menu__children">
                    <h3>{selected.name}</h3>
                    <ul>{selected.children.slice(0, 6).map((child) => <li key={child.slug}><Link href={child.href}>{child.name}<Icon name="arrow-e" size={16} /></Link></li>)}</ul>
                    <Link className="menu__view-all" href={selected.href}>{t("nav.category.all", { name: selected.name })}<Icon name="arrow-e" size={16} /></Link>
                  </div>
                )}
                </div>)}
              </div>
            </section>
          )}

          {nav.brands.length === 0 ? null : <section>
            <div className="menu__section-head"><h2>{t("nav.brands")}</h2></div>
            <ul className="menu__brands">{nav.brands.map((brand) => <li key={brand.slug}><Link href={brand.href} aria-label={brand.name}>{brand.nameEn.trim() === "" ? brand.name : <bdi>{brand.nameEn}</bdi>}</Link></li>)}</ul>
          </section>}

          {primary.length === 0 ? null : (
            <ul className="menu__primary" style={rise(0)}>
              {primary.map((item) => (
                <li key={`${item.href}:${item.label}`}>
                  <Link href={item.href}>
                    {item.label}
                    <Icon name="arrow-e" size={20} />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <details className="menu__secondary" style={rise(1)}>
            <summary><Icon name="user" size={20} />{t("account.title")}<Icon name="chevron-s" size={16} /></summary>
            <ul className="menu__list">
              <li>
                <Link href={ROUTES.account}>
                  <Icon name="user" size={20} />
                  {accountLabel}
                </Link>
              </li>
              <li>
                <Link href={ROUTES.accountOrders}>
                  <Icon name="truck" size={20} />
                  {t("account.orders")}
                </Link>
              </li>
              <li>
                <Link href={ROUTES.wishlist}>
                  <Icon name="heart" size={20} />
                  {t("shell.wishlist")}
                  {wishCount === 0 ? null : <span className="count-pill">{faInt(wishCount)}</span>}
                </Link>
              </li>
              <li>
                <Link href={ROUTES.cart}>
                  <Icon name="bag" size={20} />
                  {t("shell.cart")}
                  {cartCount === 0 ? null : <span className="count-pill">{faInt(cartCount)}</span>}
                </Link>
              </li>
              <li>
                <CompareControl variant="drawer" />
              </li>
            </ul>
          </details>

          {help.length === 0 ? null : (
            <details className="menu__secondary" style={rise(2)}>
              <summary><Icon name="chat" size={20} />{t("nav.help")}<Icon name="chevron-s" size={16} /></summary>
              <ul className="menu__list">
                {help.map((item) => (
                  <li key={`${item.href}:${item.label}`}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {hasContact ? (
            <details className="menu__secondary" style={rise(3)}>
              <summary><Icon name="phone" size={20} />{t("nav.contact")}<Icon name="chevron-s" size={16} /></summary>
              <div className="menu__contact-row">
                {whatsapp === null ? null : (
                  <a href={whatsappUrl(whatsapp)} target="_blank" rel="noopener noreferrer" className="menu__contact-main">
                    <Icon name="whatsapp" size={20} />
                    {t("product.whatsapp")}
                  </a>
                )}
                {phones.map((phone) => (
                  <a key={phone.href} href={phone.href}>
                    <Icon name="phone" size={20} />
                    <bdi dir="ltr">{phone.display}</bdi>
                  </a>
                ))}
                {instagram === "" ? null : (
                  <a href={`https://instagram.com/${instagram}`} target="_blank" rel="noopener noreferrer">
                    <Icon name="instagram" size={20} />
                    {t("footer.instagram")}
                  </a>
                )}
              </div>
              {contact === undefined || contact.hoursNote.trim() === "" ? null : (
                <p className="menu__hours">{faDigits(contact.hoursNote)}</p>
              )}
            </details>
          ) : null}

          <div className="menu__foot" style={rise(4)}>
            <ThemeToggle variant="row" />
          </div>
        </nav>
      </Drawer>
    </>
  );
}
