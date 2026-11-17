import { describe, expect, it } from "vitest";
import { zSlug } from "@namilux/core/validation";
import { alternativeSlug, automaticSlug, productSlug } from "../product-slug";

describe("new product addresses", () => {
  it("keeps Persian words, normalizes letters and includes the model once", () => {
    expect(productSlug("سرخ‌كن نينجا", "AF ۴۰۰")).toBe("سرخ-کن-نینجا-af-400");
    expect(productSlug("سرخ‌کن AF400", "AF400")).toBe("سرخ-کن-af400");
  });
  it("produces addresses accepted by core, including punctuation and long input", () => {
    for (const name of ["نینجا / مدل? #۱% ..", "ک".repeat(230), "کتری برقی"]) {
      expect(zSlug.safeParse(productSlug(name, "A/2")).success).toBe(true);
    }
  });
  it("follows name/model edits only while the new address is automatic", () => {
    expect(automaticSlug(true, "", "", "", "نینجا", "AF400")).toBe("نینجا-af400");
    expect(automaticSlug(true, "نینجا", "نینجا", "", "نینجا", "AF400")).toBe("نینجا-af400");
    expect(automaticSlug(true, "نشانی-دلخواه", "نینجا", "", "کتری", "A")).toBe("نشانی-دلخواه");
    expect(automaticSlug(false, "نینجا", "نینجا", "", "کتری", "A")).toBe("نینجا");
  });
  it("increments a retry address and respects the core length limit", () => {
    expect(alternativeSlug("نینجا")).toBe("نینجا-2");
    expect(alternativeSlug("نینجا-2")).toBe("نینجا-3");
    expect(zSlug.safeParse(alternativeSlug("ک".repeat(200))).success).toBe(true);
  });
});
