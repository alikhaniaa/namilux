import { getMenus } from "@namilux/core";
import { MenuEditor } from "@/components/content/MenuEditor";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function MenusPage() {
  await requirePermission("content.write");
  const menus = await getMenus(db);
  return (
    <div className="max-w-5xl">
      <PageHeader title={fa["nav.menus"]} />
      <MenuEditor menus={menus} />
    </div>
  );
}
