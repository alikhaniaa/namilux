import { ImageOff, Plus } from "lucide-react";
import Link from "next/link";
import { BANNER_SLOTS, formatJalali, listBannersAdmin } from "@namilux/core";
import { ButtonLink, Card, PageHeader, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { BANNER_SLOT_HINT, BANNER_SLOT_LABEL } from "@/i18n/admin-guidance";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { adminImg } from "@/lib/media";

export default async function BannersPage() {
  await requirePermission("marketing.banners");
  const slots = BANNER_SLOTS.filter((s) => s !== "promo_bar" && s !== "ig_landing");
  const lists = await Promise.all(slots.map((s) => listBannersAdmin(db, s)));
  return (
    <div className="space-y-4">
      <PageHeader
        title={fa["nav.banners"]}
        actions={
          <ButtonLink href="/marketing/banners/new" icon={<Plus size={16} aria-hidden="true" />}>
            {fa["banners.new"]}
          </ButtonLink>
        }
      />
      {slots.map((slot, i) => {
        const rows = lists[i] ?? [];
        return (
          <Card key={slot} title={BANNER_SLOT_LABEL[slot] ?? slot} {...(BANNER_SLOT_HINT[slot] === undefined ? {} : { description: BANNER_SLOT_HINT[slot] })} flush>
            {rows.length === 0 ? (
              <p className="banner-list__empty">{fa["table.empty"]}</p>
            ) : (
              <ul className="banner-list">
                {rows.map((b) => (
                  <li key={b.id}>
                    <Link href={`/marketing/banners/${String(b.id)}`} className="banner-list__row">
                      <span className="banner-list__thumb">{b.mediaLight !== null ? <img src={adminImg(b.mediaLight, 320)} alt="" loading="lazy" /> : <ImageOff size={18} aria-hidden="true" />}</span>
                      <span className="banner-list__title">{b.title}</span>
                      <span className="banner-list__dates">
                        {b.startsAt !== null ? formatJalali(b.startsAt, "short") : "…"} ← {b.endsAt !== null ? formatJalali(b.endsAt, "short") : "…"}
                      </span>
                      <StatusBadge tone={b.isActive ? "ok" : "muted"}>{b.isActive ? fa["common.active"] : fa["common.inactive"]}</StatusBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
