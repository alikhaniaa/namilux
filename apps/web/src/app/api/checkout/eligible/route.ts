import { z } from "zod";
import { INSTALMENT_INELIGIBLE_FA, MAX_LINES, instalmentBlockers, loadInstalmentEligibility } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { db } from "@/lib/db";
import { env } from "@/env";
import { handler } from "@/lib/http-handler";
const schema = z
    .object({
    amount: z.number().int().positive().max(1000000000),
    // The basket's product ids. Optional so a caller that predates the per-product switch still
    // gets an answer; the checkout always sends them. placeOrder enforces the switch regardless.
    productIds: z.array(z.number().int().positive()).min(1).max(MAX_LINES).optional(),
})
    .strict();
/**
 * May this basket be paid in instalments?
 *
 * SnappPay decides per amount - there is a credit floor, a ceiling, and per-shopper limits - so the
 * option must not be offered until their /offer/v1/eligible says yes. Everything that can go wrong
 * (gateway down, IP not yet allow-listed, driver unconfigured) resolves to "not offered": the answer
 * is the same shape either way and the shopper never sees an error about a gateway they did not pick.
 *
 * Before SnappPay is asked, the basket answers to the admin's per-product switch
 * (products.instalment_eligible): one switched-off product makes the whole basket ineligible, and
 * the answer names every such product in `ineligibleProductIds` - also without a network call,
 * since SnappPay's opinion of the amount cannot change that.
 *
 * POST, not GET, because it is a live call to a third party and must never be cached or prefetched.
 */
export const POST = handler({
    auth: "optional",
    schema,
    bodyCap: 1024,
    limit: [{ name: "checkout.quote", key: ({ ip }) => ip }],
    run: async ({ input }) => {
        if (!env.SNAPPPAY_ENABLED) return { eligible: false, applicable: false };
        if (input.productIds !== undefined) {
            const ineligibleProductIds = instalmentBlockers(await loadInstalmentEligibility(db, input.productIds));
            if (ineligibleProductIds.length > 0) {
                return { eligible: false, applicable: true, message: INSTALMENT_INELIGIBLE_FA, ineligibleProductIds };
            }
        }
        const drivers = paymentDrivers(env);
        // `PAYMENT_DRIVER=mock` funnels every gateway through the simulator, which is eligible for
        // anything - otherwise the instalment site could not be exercised without live credentials.
        const key = env.PAYMENT_DRIVER === "mock" ? "mock" : "snapppay";
        if (!drivers.configured(key))
            return { eligible: false, applicable: true };
        try {
            const driver = drivers.payment(key);
            if (driver.eligible === undefined)
                return { eligible: true, applicable: true };
            const res = await driver.eligible({ amount: input.amount });
            return { eligible: res.ok, applicable: true, ...(res.message !== undefined ? { message: res.message } : {}), ...(res.description !== undefined ? { description: res.description } : {}) };
        }
        catch {
            return { eligible: false, applicable: true };
        }
    },
});
