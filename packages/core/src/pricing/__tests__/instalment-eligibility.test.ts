import { describe, expect, it } from "vitest";
import { isAppError } from "../../errors";
import {
  INSTALMENT_INELIGIBLE,
  assertInstalmentEligible,
  instalmentBlockers,
  isInstalmentPurchasable,
} from "../instalment-eligibility";

describe("pricing/instalment-eligibility", () => {
  it("the switch only matters on the instalment channel", () => {
    expect(isInstalmentPurchasable({ instalmentEligible: true }, "instalments")).toBe(true);
    expect(isInstalmentPurchasable({ instalmentEligible: false }, "instalments")).toBe(false);
    // Card purchase on the main site never reads it.
    expect(isInstalmentPurchasable({ instalmentEligible: false }, "main")).toBe(true);
  });

  it("instalmentBlockers lists every switched-off product, sorted and deduped", () => {
    expect(instalmentBlockers([])).toEqual([]);
    expect(instalmentBlockers([{ id: 3, instalmentEligible: true }])).toEqual([]);
    expect(
      instalmentBlockers([
        { id: 9, instalmentEligible: false },
        { id: 2, instalmentEligible: true },
        { id: 4, instalmentEligible: false },
        { id: 9, instalmentEligible: false },
      ]),
    ).toEqual([4, 9]);
  });

  it("assertInstalmentEligible passes an all-eligible basket and refuses a mixed one with the blockers", () => {
    expect(() => assertInstalmentEligible([{ id: 1, instalmentEligible: true }])).not.toThrow();
    let caught: unknown;
    try {
      assertInstalmentEligible([
        { id: 1, instalmentEligible: true },
        { id: 7, instalmentEligible: false },
      ]);
    } catch (e: unknown) {
      caught = e;
    }
    expect(isAppError(caught)).toBe(true);
    expect(caught).toMatchObject({ code: "CONFLICT", httpStatus: 409, details: { reason: INSTALMENT_INELIGIBLE, productIds: [7] } });
  });
});
