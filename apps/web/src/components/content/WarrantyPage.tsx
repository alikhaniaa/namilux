import type { PageView } from "@namilux/core/client";
import { PageBody } from "./PageBody";

export function WarrantyPage({ page }: { page: PageView }): React.ReactNode {
  // OPEN-DECISIONS #6 leaves the per-brand warranty table to the owner; until those durations
  // exist as data, the legacy body is the whole page - an invented table would be a promise.
  return <PageBody page={page} />;
}
