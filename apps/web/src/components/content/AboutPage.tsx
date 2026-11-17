import { faDigits, normalizePhone, whatsappUrl } from "@namilux/core/client";
import { shopPhone } from "@/components/shell/contact";
import type {
  ImageRef,
  PageView,
  ShippingCopySetting,
  StoreContactSetting,
  StoreHoursSetting,
} from "@namilux/core/client";
import Link from "next/link";
import { CopyAddress } from "./CopyAddress";
import { StoreMap } from "./StoreMap";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { RichHtml } from "@/components/ui/RichHtml";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

/** What the page needs of a brand row; the loader maps `BrandSummary` onto it. */
export type AboutBrand = { slug: string; name: string; nameEn: string; href: string; count: number; image: ImageRef | null };

const DAYS: { key: keyof StoreHoursSetting["days"]; label: string }[] = [
  { key: "sat", label: "شنبه" },
  { key: "sun", label: "یک‌شنبه" },
  { key: "mon", label: "دوشنبه" },
  { key: "tue", label: "سه‌شنبه" },
  { key: "wed", label: "چهارشنبه" },
  { key: "thu", label: "پنج‌شنبه" },
  { key: "fri", label: "جمعه" },
];

/**
 * The five promises, in the order a shopper meets them: what the box holds, what happens after it
 * is opened, what happens if it was the wrong choice, how it arrives, and the help that comes
 * before any of it. Only the shipping line is settings copy - the owner writes «ارسال رایگان به
 * سراسر ایران» in `shipping.copy.freeLine` and the footer already quotes the same string, so the
 * page must not invent a second wording for it.
 */
const PROMISES: { key: string; icon: IconName; title: FaKey; body: FaKey | null; href: string | null }[] = [
  { key: "authenticity", icon: "shield", title: "page.about.promise.authenticity", body: "page.about.promise.authenticity.body", href: null },
  { key: "warranty", icon: "check", title: "page.about.promise.warranty", body: "page.about.promise.warranty.body", href: "/warranty/" },
  { key: "return", icon: "back", title: "page.about.promise.return", body: "page.about.promise.return.body", href: "/shipping-returns/" },
  { key: "shipping", icon: "truck", title: "page.about.promise.shipping", body: null, href: null },
  { key: "advice", icon: "chat", title: "page.about.promise.advice", body: "page.about.promise.advice.body", href: null },
];

/** A published number becomes a tappable link; a blank or malformed setting renders nothing. */
function PhoneLink({ phone, icon }: { phone: string; icon: IconName }): React.ReactNode {
  const number = shopPhone(phone);
  if (number === null) return null;
  return (
    <li>
      <a href={number.href} className="about-visit__line link-under">
        <Icon name={icon} size={20} />
        {/* Settings store the ASCII form; nothing but Persian digits reaches the page. */}
        <bdi dir="ltr" className="tnum">{number.display}</bdi>
      </a>
    </li>
  );
}

/**
 * «دربارهٔ ما» - who the shop is, not how to reach it.
 *
 * DECISION - this page is deliberately NOT a second contact page. `/contact-us/` (the `contact`
 * template, with the message form) and `/store/` (the `store` template, with the full opening-hours
 * table) already exist, and three pages repeating one address is how a site ends up competing with
 * itself in search. So the identity comes first and takes the room - the prose, the houses the shop
 * actually carries, the promises - and the practical block at the end is a summary that hands the
 * visitor on: one line of hours, the address, two numbers, the map, and a link to each of the other
 * two pages for everything this one deliberately leaves out.
 *
 * Every fact here is settings or catalogue. The PROSE is the `pages` row, so an owner rewrites the
 * story from the back office without a deploy; the brand list follows the `brands` table, which is
 * the whole point of not hard-coding it - the catalogue has already gone from two houses to five.
 */
export function AboutPage({
  page,
  contact,
  hours,
  shipping,
  brands,
}: {
  page: PageView;
  contact: StoreContactSetting;
  hours: StoreHoursSetting;
  shipping: ShippingCopySetting;
  brands: AboutBrand[];
}): React.ReactNode {
  const whatsapp = normalizePhone(contact.whatsapp);
  const address = contact.address.trim();
  const hoursNote = hours.note.trim();

  return (
    <>
      {/* the spec: exactly one <h1> per page, and it is the page's own title. */}
      <article className="wrap section about-intro">
        <p className="eyebrow">{t("page.about.kicker")}</p>
        <h1 className="d-1">{page.title}</h1>
        <RichHtml html={page.bodyHtml} className="about-intro__prose" />
      </article>

      {/* The houses, on the graphite frame - the same band the home page gives the shop itself, so
          the About page reads as part of the site and not as a document attached to it. */}
      {brands.length === 0 ? null : (
        <section className="frame chapter about-brands" aria-labelledby="about-brands">
          <div className="wrap grid gap-6">
            <div className="grid gap-3">
              <h2 id="about-brands" className="d-2 text-frame-ink">
                {t("page.about.brands.title")}
              </h2>
              <p className="t-lead max-w-[52ch] text-frame-ink-2">{t("page.about.brands.body")}</p>
            </div>
            <ul className="about-brands__grid">
              {brands.map((brand) => (
                <li key={brand.slug}>
                  <Link href={brand.href} className="about-brands__item">
                    <span className="about-brands__mark">
                      {brand.image === null ? (
                        <span className="about-brands__wordmark">{brand.nameEn}</span>
                      ) : (
                        <Img image={brand.image} slot="thumb" alt={brand.name} />
                      )}
                    </span>
                    <span className="about-brands__name t-sm">{brand.name}</span>
                    {/* faDigits via the {n} interpolation of `t` - never a Latin count. */}
                    <span className="about-brands__count t-xs">{t("page.about.brands.count", { n: brand.count })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="wrap section grid gap-6" aria-labelledby="about-promises">
        <h2 id="about-promises" className="d-2">
          {t("page.about.promises.title")}
        </h2>
        <ul className="about-promises">
          {PROMISES.map((promise) => (
            <li key={promise.key} className="about-promises__item">
              <span className="about-promises__icon">
                <Icon name={promise.icon} size={24} />
              </span>
              <h3 className="t-sm about-promises__title">
                {promise.href === null ? (
                  t(promise.title)
                ) : (
                  <Link href={promise.href} className="link-under">
                    {t(promise.title)}
                  </Link>
                )}
              </h3>
              {/* The shipping promise has no body of its own: the owner's own line is the body. */}
              <p className="t-sm text-ink-2">
                {promise.key === "shipping" ? faDigits(shipping.freeLine) : promise.body === null ? "" : t(promise.body)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap section about-visit" aria-labelledby="about-visit">
        <div className="about-visit__text">
          <h2 id="about-visit" className="d-2">
            {t("page.about.visit.title")}
          </h2>
          <p className="t-lead max-w-[46ch] text-ink-2">{t("page.about.visit.body")}</p>

          {address === "" ? null : (
            <div className="grid gap-3">
              <h3 className="label-fa text-ink-3">{t("page.about.address")}</h3>
              <p className="t-body max-w-[42ch]">{address}</p>
              <CopyAddress address={address} />
            </div>
          )}

          {hoursNote === "" ? null : (
            <div className="grid gap-2">
              <h3 className="label-fa text-ink-3">{t("page.store.hours")}</h3>
              {/* The one-line summary; the per-day table is the store page's job, and this page
                  links there rather than printing the same seven rows a second time. */}
              <p className="t-body">{faDigits(hoursNote)}</p>
              <p className="t-xs text-ink-3">{openDaysLine(hours)}</p>
            </div>
          )}

          <ul className="grid gap-2">
            <PhoneLink phone={contact.phoneMobile} icon="phone" />
            {whatsapp === null ? null : (
              <li>
                {/* Leaves the site, so a bare <a> with rel="noopener": <Link> carries no rel. */}
                <a
                  href={whatsappUrl(whatsapp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-visit__line link-under"
                >
                  <Icon name="whatsapp" size={20} />
                  {t("product.whatsapp")}
                </a>
              </li>
            )}
          </ul>

          {/* Cross-links, not copies: everything this block leaves out lives on one of these two. */}
          <p className="about-visit__more t-sm">
            <Link href="/contact-us/" className="link-under">
              {t("page.about.more.contact")}
            </Link>
            <Link href="/store/" className="link-under">
              {t("page.about.more.store")}
            </Link>
          </p>
        </div>

        <StoreMap mapUrl={contact.mapUrl} />
      </section>
    </>
  );
}

/**
 * «شنبه تا پنج‌شنبه» / «همه‌روزه» / «تعطیل: جمعه» - the shape of the week in one line, derived from
 * the same setting the store page tabulates. A closed day is worth saying on an About page; seven
 * rows are not.
 */
function openDaysLine(hours: StoreHoursSetting): string {
  const closed = DAYS.filter((d) => hours.days[d.key] === null);
  if (closed.length === 0) return t("page.about.hours.everyday");
  if (closed.length === DAYS.length) return t("page.store.closed");
  return `${t("page.store.closed")}: ${closed.map((d) => d.label).join("، ")}`;
}
