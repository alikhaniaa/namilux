import { getSettings } from "@namilux/core";
import { DEFAULT_SMS_TEMPLATES } from "@namilux/integrations";
import { SmsTemplatesEditor } from "@/components/settings/SmsTemplatesEditor";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function SmsTemplatesPage() {
  await requirePermission("settings.read");
  const settings = await getSettings(db);
  return (
    <div className="max-w-4xl">
      <PageHeader title={fa["smsTpl.title"]} subtitle={fa["smsTpl.vars"]} />
      {/* The fallback bodies are the SHIPPED wording (@namilux/integrations), not
          DEFAULT_SETTINGS["sms.templates"] - that one is `{}`, so this page, which the operator
          manual calls the record of what is registered with FarazSMS, showed fifteen empty boxes and
          no variable badges (found 9 Sep 2026). The stored setting still wins where it has a row. */}
      <SmsTemplatesEditor initial={settings["sms.templates"]} defaults={DEFAULT_SMS_TEMPLATES} />
    </div>
  );
}
