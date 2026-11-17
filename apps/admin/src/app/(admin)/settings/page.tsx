import Link from "next/link";
import {
  BadgeCheck,
  Bell,
  Clock,
  CreditCard,
  FileSearch,
  Flag,
  Info,
  KeyRound,
  Megaphone,
  MessageSquareText,
  Phone,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SETTINGS_KEYS, can, isMoneySettingsKey } from "@namilux/core";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { SETTINGS_GROUP_BLURB } from "@/i18n/admin-guidance";
import { groupLabel } from "@/i18n/settings-groups";
import { requirePermission } from "@/lib/authz";

const SPECIAL: Record<string, string> = { "sms.templates": "/settings/sms-templates", "loyalty.rules": "/marketing/loyalty", "promo.bar": "/marketing/promo" };

const ICON: Record<string, LucideIcon> = {
  "store.info": Info,
  "store.contact": Phone,
  "store.hours": Clock,
  "store.social": Share2,
  "seals.enamad_code": BadgeCheck,
  "seals.samandehi_code": BadgeCheck,
  "seals.enamad_code_instalments": BadgeCheck,
  "seals.samandehi_code_instalments": BadgeCheck,
  "commerce.checkout_enabled": CreditCard,
  "commerce.maintenance": Wrench,
  "commerce.max_per_order": CreditCard,
  "commerce.pending_ttl_min": Clock,
  "commerce.vat_percent": CreditCard,
  "commerce.installments": CreditCard,
  "shipping.copy": Truck,
  "loyalty.rules": Sparkles,
  "otp.limits": KeyRound,
  "sms.templates": MessageSquareText,
  "notify.telegram": Bell,
  "promo.bar": Megaphone,
  "seo.defaults": Search,
  "pwa.coach": Smartphone,
  "analytics.sampling": FileSearch,
  "flags": Flag,
};

/** The settings groups by what they are about, in the order a shop owner looks for them. */
const SECTIONS: { title: string; keys: string[] }[] = [
  { title: fa["settings.section.store"], keys: ["store.info", "store.contact", "store.hours", "store.social"] },
  { title: fa["settings.section.checkout"], keys: ["commerce.checkout_enabled", "commerce.maintenance", "commerce.max_per_order", "commerce.pending_ttl_min", "commerce.vat_percent", "shipping.copy"] },
  { title: fa["settings.section.seals"], keys: ["seals.enamad_code", "seals.samandehi_code"] },
  { title: fa["settings.section.customers"], keys: ["loyalty.rules", "otp.limits", "sms.templates", "notify.telegram", "promo.bar"] },
  { title: fa["settings.section.advanced"], keys: ["seo.defaults", "pwa.coach", "analytics.sampling", "flags"] },
];

function Tile({ href, title, blurb, Icon }: { href: string; title: string; blurb: string | undefined; Icon: LucideIcon }) {
  return (
    <Link href={href} className="settings-tile">
      <span className="settings-tile__icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="settings-tile__text">
        <b>{title}</b>
        {blurb !== undefined ? <small>{blurb}</small> : null}
      </span>
    </Link>
  );
}

export default async function SettingsPage() {
  const staff = await requirePermission("settings.read");
  const money = can(staff, "settings.money");
  // The index lists only what this staff member may open - the money groups are the owner's.
  const allowed = new Set<string>(SETTINGS_KEYS.filter((k) => k !== "system.contract" && (money || !isMoneySettingsKey(k))));
  const placed = new Set(SECTIONS.flatMap((s) => s.keys));
  const rest = [...allowed].filter((k) => !placed.has(k));
  const sections = [...SECTIONS.map((s) => ({ ...s, keys: s.keys.filter((k) => allowed.has(k)) })), ...(rest.length > 0 ? [{ title: fa["settings.section.other"], keys: rest }] : [])].filter((s) => s.keys.length > 0);

  return (
    <div className="settings-index">
      <PageHeader title={fa["nav.settings"]} />
      {sections.map((s) => (
        <section key={s.title} className="settings-index__section">
          <h2>{s.title}</h2>
          <div className="settings-index__grid">
            {s.keys.map((k) => (
              <Tile key={k} href={SPECIAL[k] ?? `/settings/${encodeURIComponent(k)}`} title={groupLabel(k)} blurb={SETTINGS_GROUP_BLURB[k]} Icon={ICON[k] ?? Info} />
            ))}
          </div>
        </section>
      ))}
      <section className="settings-index__section">
        <h2>{fa["settings.section.team"]}</h2>
        <div className="settings-index__grid">
          <Tile href="/settings/shipping" title={fa["shipping.title"]} blurb={fa["settings.blurb.shipping"]} Icon={Truck} />
          {can(staff, "staff.manage") ? (
            <>
              <Tile href="/settings/staff" title={fa["settings.staff"]} blurb={fa["settings.blurb.staff"]} Icon={Users} />
              <Tile href="/settings/roles" title={fa["settings.roles"]} blurb={fa["settings.blurb.roles"]} Icon={ShieldCheck} />
            </>
          ) : null}
          <Tile href="/account" title={fa["settings.sessions"]} blurb={fa["settings.blurb.sessions"]} Icon={KeyRound} />
          {/* the 752-URL SEO parity report - a read-only report, part of the SEO work an admin owns */}
          <Tile href="/settings/system.contract" title={fa["health.contract"]} blurb={fa["settings.blurb.contract"]} Icon={FileSearch} />
        </div>
      </section>
    </div>
  );
}
