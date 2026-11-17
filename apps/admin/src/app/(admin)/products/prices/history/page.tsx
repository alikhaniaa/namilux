import Link from "next/link";
import { PRICE_LOG_LIMIT, listPriceChanges } from "@namilux/core";
import { faInt, formatToman } from "@namilux/core/client";
import { EmptyState } from "@/components/kit";
import { Delta } from "@/components/pricing/parts";
import { RevertPrice } from "@/components/pricing/RevertPrice";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { normalizeProductQuery } from "@/lib/product-filters";
import { logTime, sourceLabel, tehranDayStart } from "@/lib/pricing";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const RANGES = [
  { key: "today", label: "امروز", daysBack: 0 },
  { key: "7", label: "۷ روز", daysBack: 6 },
  { key: "30", label: "۳۰ روز", daysBack: 29 },
] as const;

export default async function PriceHistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("catalog.price");
  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === first(sp.range)) ?? RANGES[0];
  const q = normalizeProductQuery(first(sp.q) ?? "");
  const now = Date.now();
  const { rows, more } = await listPriceChanges(db, { since: tehranDayStart(now, range.daysBack), ...(q === "" ? {} : { q }) });
  const href = (key: string): string => `/products/prices/history?range=${key}${q === "" ? "" : `&q=${encodeURIComponent(q)}`}`;

  return (
    <div className="price-flow">
      <div className="price-toolbar__row">
        <nav className="ui-segmented" aria-label="بازهٔ زمانی">
          {RANGES.map((r) => (
            <Link key={r.key} href={href(r.key)} className="ui-segmented__item" aria-current={r.key === range.key ? "page" : undefined}>
              {r.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="price-log__search">
          <input type="hidden" name="range" value={range.key} />
          <input type="search" name="q" className="ui-input" defaultValue={q} placeholder="نام یا کد کالا…" aria-label="جستجوی کالا در تاریخچه" />
          <button type="submit" className="ui-btn ui-btn--outline">جستجو</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState text={q === "" ? "در این بازه قیمتی تغییر نکرده است." : "برای این جستجو تغییری پیدا نشد."} />
      ) : (
        <>
          <p className="price-flow__count">
            <b>{faInt(rows.length)}</b> تغییر قیمت{more ? ` (تازه‌ترین ${faInt(PRICE_LOG_LIMIT)} مورد)` : ""}
          </p>
          <div className="admin-table-scroll">
            <table className="admin-data-table is-cards price-preview">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th>قیمت قبلی</th>
                  <th>قیمت جدید</th>
                  <th>تغییر</th>
                  <th>زمان</th>
                  <th>ثبت‌کننده</th>
                  <th>
                    <span className="sr-only">برگرداندن</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-primary">
                      <span className="cell-product__text">
                        <Link href={`/products/${String(r.productId)}`} className="cell-name hover:text-[var(--accent)]">
                          {r.displayName}
                        </Link>
                        <small className="cell-muted">
                          {r.brandName ?? "بدون برند"}
                          {r.code !== null && !r.displayName.includes(r.code) ? <> · <bdi>{r.code}</bdi></> : null}
                        </small>
                      </span>
                    </td>
                    <td data-label="قیمت قبلی">{r.before === null ? "—" : <bdi className="money">{r.before.price === 0 ? "استعلامی" : formatToman(r.before.price)}</bdi>}</td>
                    <td data-label="قیمت جدید" className="cell-num">
                      <bdi className="money">{r.after.price === 0 ? "استعلامی" : formatToman(r.after.price)}</bdi>
                    </td>
                    <td data-label="تغییر">
                      {r.before === null ? (
                        <span className="cell-muted">اولین قیمت</span>
                      ) : r.before.price === r.after.price ? (
                        <span className="cell-muted">قیمت قبل از تخفیف</span>
                      ) : (
                        <Delta before={r.before.price} after={r.after.price} />
                      )}
                    </td>
                    <td data-label="زمان" className="cell-muted whitespace-nowrap">
                      {logTime(r.createdAt, now)}
                    </td>
                    <td data-label="ثبت‌کننده">
                      <span className="cell-product__text">
                        <span>{r.actorName ?? (r.actorType === "staff" ? "کارمند حذف‌شده" : "سیستم")}</span>
                        <small className="cell-muted">{sourceLabel(r.note, r.actorType)}</small>
                      </span>
                    </td>
                    <td className="cell-actions">
                      {r.revertible && r.before !== null ? <RevertPrice productId={r.productId} name={r.displayName} current={r.after} previous={r.before} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
