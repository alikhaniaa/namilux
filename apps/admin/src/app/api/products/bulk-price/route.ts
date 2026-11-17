import { appError, bulkPrice, bulkPriceSchema, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { assertFreshSudo } from "@/lib/authz";
import { db } from "@/lib/db";
import { normalizeWireFilter, wireHasCriteria } from "@/lib/product-filters";

export const POST = adminHandler({
  schema: bulkPriceSchema,
  permission: "catalog.bulk",
  sudo: false, // preview needs no sudo; apply asserts it below
  run: async ({ input, req, staff, ip }) => {
    // The filter scope goes to the core through the same folding the product list's URL uses, so the
    // rows this reaches are the rows the admin saw. Without it a body could send «%» and reprice the
    // catalogue behind a filter-shaped scope.
    const scope =
      input.scope.kind === "filter" ? { kind: "filter" as const, filter: normalizeWireFilter(input.scope.filter) } : input.scope;
    // A filter scope with nothing in it resolves to every non-archived product. The form never sends
    // one, but the guard lives here so a hand-built request cannot reprice the catalogue.
    if (scope.kind === "filter" && !wireHasCriteria(scope.filter)) {
      throw appError("VALIDATION", { details: { field: "scope.filter", reason: "empty_filter" } });
    }
    const dryRun = new URL(req.url).searchParams.get("dryRun") !== "0";
    if (!dryRun) assertFreshSudo(req, staff, "catalog.bulk");
    const result = await bulkPrice(db, { ...input, scope }, { type: "staff", id: staff.id, ip }, dryRun);
    return dryRun ? result : { ...result, revalidate: [tags.catalog, tags.home] };
  },
});
