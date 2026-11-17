import { ImportWizard } from "@/components/products/ImportWizard";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";

export default async function ImportPage() {
  await requirePermission("catalog.bulk");
  return (
    <div className="max-w-5xl">
      <PageHeader title={fa["products.import"]} />
      <ImportWizard />
    </div>
  );
}
