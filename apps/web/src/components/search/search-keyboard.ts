/** Keyboard selection belongs to the overlay's input, never to other inputs or the whole page. */
export function bindSearchKeyboard(owner: HTMLInputElement, options: {
  query: string;
  hrefs: readonly string[];
  active: number;
  move: (direction: 1 | -1) => void;
  navigate: (href: string) => void;
}): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    // Results lag typing by the debounce interval. Enter during that interval must submit the new
    // query, rather than navigating to the old query's highlighted result.
    if (owner.value.trim() !== options.query.trim()) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.hrefs.length === 0) return;
      event.preventDefault();
      options.move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      const href = options.hrefs[options.active];
      if (href === undefined) return;
      event.preventDefault();
      options.navigate(href);
    }
  };
  owner.addEventListener("keydown", onKey);
  return () => owner.removeEventListener("keydown", onKey);
}
