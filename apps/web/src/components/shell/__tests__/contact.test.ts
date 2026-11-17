import { describe, expect, it } from "vitest";
import { shopPhones } from "../contact";

describe("published shop phones", () => {
  it("puts the dialable landline before the existing mobile", () => {
    expect(shopPhones({ phoneLand: "02155550000", phoneMobile: "09121230077" }).map((p) => p.href))
      .toEqual(["tel:+982155550000", "tel:+989121230077"]);
  });
  it("omits empty settings", () => {
    expect(shopPhones({ phoneLand: "", phoneMobile: "" })).toEqual([]);
  });
});
