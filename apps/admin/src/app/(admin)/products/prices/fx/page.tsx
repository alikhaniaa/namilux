import { FxRates } from "@/components/pricing/FxRates";
import { requirePermission } from "@/lib/authz";

export default async function FxRatesPage() {
  await requirePermission("catalog.bulk");
  return <FxRates />;
}
