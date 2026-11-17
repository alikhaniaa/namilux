import type { Crumb } from "@namilux/core/client";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { t } from "@/i18n";

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }): React.ReactNode {
  // «خانه» is prepended here rather than stored on every entity, so the chain the page hands over
  // is exactly the category path core resolved. The JSON-LD BreadcrumbList is emitted by the page
  // from the same array - one source, two renderings.
  return <Breadcrumb crumbs={[{ name: t("tab.home"), href: "/" }, ...crumbs]} />;
}
