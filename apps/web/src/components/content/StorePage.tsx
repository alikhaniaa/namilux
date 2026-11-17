import { faDigits } from "@namilux/core/client";
import type { ImageRef, PageView, StoreHoursSetting, StoreInfo } from "@namilux/core/client";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { RichHtml } from "@/components/ui/RichHtml";
import { t } from "@/i18n";

const DAYS: { key: keyof StoreHoursSetting["days"]; label: string }[] = [
  { key: "sat", label: "شنبه" },
  { key: "sun", label: "یک‌شنبه" },
  { key: "mon", label: "دوشنبه" },
  { key: "tue", label: "سه‌شنبه" },
  { key: "wed", label: "چهارشنبه" },
  { key: "thu", label: "پنج‌شنبه" },
  { key: "fri", label: "جمعه" },
];

export function StorePage({
  page,
  store,
  hours,
  photo,
}: {
  page: PageView;
  store: StoreInfo;
  hours: StoreHoursSetting;
  /** DECISION: the store photograph is a banner (slot `home_band`/`ig_landing`), not a field of
      `StoreInfo`, so the page hands it over rather than the settings carrying it. */
  photo?: ImageRef;
}): React.ReactNode {
  return (
    <>
      {photo === undefined ? null : (
        <div className="plate plate--wide plate--wide-to-ultra">
          <Img image={photo} slot="hero" alt="" priority />
        </div>
      )}
      <article className="wrap section grid gap-6 md:grid-cols-2">
        <div className="grid gap-5">
          <h1 className="d-1">{page.title}</h1>
          <RichHtml html={page.bodyHtml} />
        </div>
        <aside className="grid content-start gap-4">
          <p className="t-body">{store.address}</p>
          <a
            href={store.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--secondary justify-self-start"
          >
            <Icon name="location" size={20} />
            {t("page.store.directions")}
          </a>
          <h2 className="label-fa text-ink-3">{t("page.store.hours")}</h2>
          <table className="w-full border-collapse">
            <tbody>
              {DAYS.map((d, i) => {
                const window = hours.days[d.key];
                return (
                  <tr key={d.key} className={i % 2 === 1 ? "bg-soft" : undefined}>
                    <th scope="row" className="t-sm p-2 text-start font-medium text-ink-2">
                      {d.label}
                    </th>
                    {/* Persian digits, and a closed day says so rather than showing an empty cell. */}
                    <td className="t-sm tnum p-2">
                      {window === null ? t("page.store.closed") : `${faDigits(window.open)} تا ${faDigits(window.close)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </aside>
      </article>
    </>
  );
}
