import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DescriptionToggle } from "../DescriptionToggle";
import { SwatchRow } from "../SwatchRow";

describe("presentation details", () => {
  it("server-renders the description preview and complete body without a closed details element", () => {
    const html = renderToStaticMarkup(<DescriptionToggle><div className="prose"><p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p><p>Full final paragraph</p></div></DescriptionToggle>);
    expect(html).toContain("First paragraph");
    expect(html).toContain("Full final paragraph");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("display:none");
  });
  it("does not render meaningless empty color circles", () => {
    expect(renderToStaticMarkup(<SwatchRow variants={[]} selectedId={1} mode="card" />)).toBe("");
  });
});
