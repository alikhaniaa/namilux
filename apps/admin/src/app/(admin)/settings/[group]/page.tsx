import { notFound, redirect } from "next/navigation";
import { INSTALMENT_ROUND_STEPS, SETTINGS_KEYS, can, formatToman, getSettings, isMoneySettingsKey } from "@namilux/core";
import type { SettingsKey } from "@namilux/core";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { PageHeader } from "@/components/kit";
import { SETTINGS_GROUP_BLURB } from "@/i18n/admin-guidance";
import { fieldLabels, groupLabel } from "@/i18n/settings-groups";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function SettingsGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const staff = await requirePermission("settings.read");
  const { group } = await params;
  const key = decodeURIComponent(group);
  if (key === "commerce.installments" || key.endsWith("_instalments")) redirect("/settings");
  if (!(SETTINGS_KEYS as readonly string[]).includes(key)) notFound();
  // A money group is a 404 for an admin, not a redirect: the page they may not open should not
  // confirm it exists. The API behind it refuses the same key with `settings.money`.
  if (isMoneySettingsKey(key) && !can(staff, "settings.money")) notFound();
  if (key === "sms.templates") redirect("/settings/sms-templates");
  if (key === "loyalty.rules") redirect("/marketing/loyalty");
  const all = await getSettings(db);
  const value = all[key as SettingsKey];
  return (
    <div className="max-w-3xl">
      <PageHeader title={groupLabel(key)} {...(SETTINGS_GROUP_BLURB[key] === undefined ? {} : { subtitle: SETTINGS_GROUP_BLURB[key] })} back={{ href: "/settings", label: fa["nav.settings"] }} />
      <SettingsForm
        group={key}
        groupLabel={groupLabel(key)}
        initial={value as Parameters<typeof SettingsForm>[0]["initial"]}
        readOnly={key === "system.contract"}
        labels={fieldLabels()}
        options={{ roundTo: INSTALMENT_ROUND_STEPS.map((step) => ({ value: step, label: formatToman(step) })) }}
      />
    </div>
  );
}
