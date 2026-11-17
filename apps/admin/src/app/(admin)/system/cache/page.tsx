import { CacheTools } from "@/components/system/CacheTools";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";

export default async function CachePage() {
  await requirePermission("system.cache");
  return (
    <div className="max-w-3xl">
      <PageHeader title={fa["nav.cache"]} />
      <CacheTools />
    </div>
  );
}
