import { describe, expect, it, vi } from "vitest";
import { bindSearchKeyboard } from "../search-keyboard";

function input(value: string): HTMLInputElement {
  return Object.assign(new EventTarget(), { value }) as HTMLInputElement;
}

function key(value: string, extra: Partial<KeyboardEvent> = {}): Event {
  return Object.assign(new Event("keydown", { cancelable: true }), { key: value, ...extra });
}

function setup() {
  const owner = input("قهوه");
  const move = vi.fn();
  const navigate = vi.fn();
  const dispose = bindSearchKeyboard(owner, { query: "قهوه", hrefs: ["/product/coffee/"], active: 0, move, navigate });
  return { owner, move, navigate, dispose };
}

describe("search overlay keyboard ownership", () => {
  it("does not intercept Enter or arrows in unrelated page controls", () => {
    const { navigate, move, dispose } = setup();
    const unrelated = input("شماره تماس");
    for (const name of ["Enter", "ArrowDown", "ArrowUp"]) {
      const event = key(name);
      unrelated.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    dispose();
  });

  it("moves and opens results while typing in the owning search field", () => {
    const { owner, navigate, move, dispose } = setup();
    for (const name of ["ArrowDown", "ArrowUp", "Enter"]) {
      const event = key(name);
      owner.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(move.mock.calls).toEqual([[1], [-1]]);
    expect(navigate).toHaveBeenCalledWith("/product/coffee/");
    dispose();
  });

  it("lets a changed query submit while its old results are still displayed", () => {
    const { owner, navigate, move, dispose } = setup();
    owner.value = "کتری";
    for (const name of ["Enter", "ArrowDown"]) {
      const event = key(name);
      owner.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    dispose();
  });

  it("leaves composition and browser shortcuts alone and removes its listener on close", () => {
    const { owner, navigate, dispose } = setup();
    for (const modifier of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const event = key("Enter", modifier);
      owner.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    dispose();
    owner.dispatchEvent(key("Enter"));
    expect(navigate).not.toHaveBeenCalled();
  });
});
