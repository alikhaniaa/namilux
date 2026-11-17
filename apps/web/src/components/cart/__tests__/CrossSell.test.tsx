import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mediaUrl, productUrl } from "@namilux/core/client";
import { t } from "@/i18n";
import { CrossSell } from "../CrossSell";

vi.mock("@/components/search/useSearchIndex", () => ({
  useSearchIndex: () => ({
    index: [{ id: 7, slug: "قهوه ساز", dn: "قهوه ساز آزمون", b: "برند", p: 0, s: false, c: [], i: "p/coffee/320.webp" }],
    loading: false,
    error: false,
  }),
}));

describe("cart recommendations", () => {
  it("shows the catalogue image and an enquiry label for on-request products", () => {
    const html = renderToStaticMarkup(<CrossSell ids={[7]} />);
    expect(html).toContain(`src="${mediaUrl("p/coffee/320.webp")}"`);
    expect(html).toContain(`href="${productUrl("قهوه ساز")}"`);
    expect(html).toContain(t("product.onRequest"));
    expect(html).not.toContain(t("product.price.unit"));
  });
});
