import { describe, expect, it } from "vitest";
import { JOB_TYPES, JOB_STATUSES, SECURITY_EVENT_KINDS, MOVEMENT_REASONS, BASE_CURRENCIES, ROBOTS_VALUES } from "@namilux/core/client";
import { JOB_LABELS, SECURITY_LABELS, statusLabel, movementLabel, currencyLabel, robotsLabel } from "../admin-labels";

describe("operator-facing labels", () => {
  it("covers the actual core job and security vocabularies", () => {
    for (const type of JOB_TYPES) expect(JOB_LABELS[type], type).toMatch(/[آ-ی]/u);
    for (const kind of SECURITY_EVENT_KINDS) expect(SECURITY_LABELS[kind], kind).toMatch(/[آ-ی]/u);
  });
  it("never leaks raw values in status, inventory, currency or search controls", () => {
    for (const [values, label] of [[JOB_STATUSES, statusLabel], [MOVEMENT_REASONS, movementLabel], [BASE_CURRENCIES, currencyLabel], [ROBOTS_VALUES, robotsLabel]] as const) {
      for (const value of values) expect(label(value)).not.toMatch(/[A-Za-z]/);
    }
    expect(statusLabel("new_internal_state")).toBe("وضعیت نامشخص");
  });
});
