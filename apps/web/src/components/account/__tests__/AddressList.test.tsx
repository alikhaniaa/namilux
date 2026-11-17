import { renderToStaticMarkup } from "react-dom/server";
import type { Dispatch, SetStateAction } from "react";
import type * as ReactModule from "react";
import type { Address } from "@namilux/core/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { AddressList } from "../AddressList";

type Control = { children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean };
const harness = vi.hoisted((): { slots: Map<number, unknown>; cursor: number; controls: Control[]; refresh: ReturnType<typeof vi.fn> } => ({
  slots: new Map(), cursor: 0, controls: [], refresh: vi.fn(),
}));

// Keep the component's hooks across static renders while exercising its real request handlers.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useEffect: () => {},
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      const slot = harness.cursor++;
      if (!harness.slots.has(slot)) harness.slots.set(slot, initial);
      return [harness.slots.get(slot) as T, (next) => {
        harness.slots.set(slot, typeof next === "function" ? (next as (previous: T) => T)(harness.slots.get(slot) as T) : next);
      }];
    },
    useRef: <T,>(initial: T): { current: T } => {
      const slot = harness.cursor++;
      if (!harness.slots.has(slot)) harness.slots.set(slot, { current: initial });
      return harness.slots.get(slot) as { current: T };
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("@/components/ui/Sheet", () => ({ Sheet: () => null }));
vi.mock("@/components/ui/Button", () => ({ Button: (props: Control) => {
  harness.controls.push(props);
  return <button disabled={props.disabled} aria-busy={props.loading}>{props.children}</button>;
} }));

const address: Address = {
  id: "01K00000000000000000000001", customerId: "01K00000000000000000000002", label: "خانه", recipientName: "مشتری آزمون",
  recipientPhone: "09120000000", province: "THR", city: "تهران", address: "خیابان نمونه، ساختمان آزمون", plaque: "1", unit: null,
  postcode: "1234567890", isDefault: false, createdAt: "2026-10-08T00:00:00.000Z",
};
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const render = (): string => {
  harness.cursor = 0;
  harness.controls = [];
  return renderToStaticMarkup(<AddressList addresses={[address]} />);
};
const control = (label: string): Control => {
  const found = harness.controls.find((item) => item.children === label);
  if (found === undefined) throw new Error(`Missing action: ${label}`);
  return found;
};

beforeEach(() => {
  harness.slots.clear();
  harness.refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("saved address actions", () => {
  it.each(["account.addresses.delete", "account.addresses.setDefault"] as const)("announces a rejected %s action outside the closed editor", async (key) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render();
    control(t(key)).onClick?.();
    await drain();
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(t("checkout.error.generic"));
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(control(t(key)).disabled).toBe(false);
  });

  it("handles a network failure without an unhandled rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render();
    control(t("account.addresses.delete")).onClick?.();
    await drain();
    expect(render()).toContain(t("checkout.error.generic"));
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it("blocks duplicate mutations until the request finishes, then refreshes on success", async () => {
    let finish: (response: Response) => void = () => {};
    const request = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn().mockReturnValue(request);
    vi.stubGlobal("fetch", fetchMock);
    render();
    const click = control(t("account.addresses.setDefault")).onClick;
    click?.();
    click?.();
    render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/me/addresses/${address.id}/`, expect.objectContaining({ method: "PUT", body: '{"isDefault":true}' }));
    expect(harness.controls.every((item) => item.disabled === true)).toBe(true);
    expect(control(t("account.addresses.setDefault")).loading).toBe(true);
    finish(new Response(null, { status: 200 }));
    await drain();
    expect(render()).not.toContain('role="alert"');
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(control(t("account.addresses.setDefault")).disabled).toBe(false);
  });
});
