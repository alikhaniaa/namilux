import { expect, it } from "vitest";
import { displaySmsTemplate, storedSmsTemplate } from "../sms-template-text";

it("round-trips Persian placeholders without changing the sending contract", () => {
  const stored = "سفارش {sefaresh} با کد {code} در {site}/account، {carrier} {tracking}";
  expect(displaySmsTemplate(stored)).toContain("{شماره سفارش}");
  expect(storedSmsTemplate(displaySmsTemplate(stored))).toBe(stored);
  expect(storedSmsTemplate("سفارش {شماره سفارش} آماده شد")).toBe("سفارش {sefaresh} آماده شد");
  expect(storedSmsTemplate(displaySmsTemplate("{future_variable}"))).toBe("{future_variable}");
});
