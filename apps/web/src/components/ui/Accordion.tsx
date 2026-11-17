"use client";
import { useId, useState } from "react";
import { Icon } from "./Icon";

export function Accordion({
  items,
  single = false,
}: {
  // `meta` (optional, added 3 Sep 2026): a small element after the title - the filter sheet shows how
  // many options of the group are picked.
  items: { id: string; title: string; content: React.ReactNode; defaultOpen?: boolean; meta?: React.ReactNode }[];
  single?: boolean;
}): React.ReactNode {
  const base = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.filter((i) => i.defaultOpen === true).map((i) => i.id)));

  const toggle = (id: string): void => {
    setOpen((prev) => {
      const next = single ? new Set<string>() : new Set(prev);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      {items.map((item) => {
        const isOpen = open.has(item.id);
        const panelId = `${base}-${item.id}`;
        return (
          <div key={item.id} className="hairline-b">
            <h3>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 py-4 text-start"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                <span className="flex items-center gap-2">
                  <span className="t-body font-semibold">{item.title}</span>
                  {item.meta}
                </span>
                <Icon name={isOpen ? "minus" : "plus"} size={20} />
              </button>
            </h3>
            {/* grid-template-rows 0fr → 1fr animates to the content's real height without measuring
                it in JS; the inner element owns the overflow so nothing clips early. */}
            <div className="accordion__panel" data-open={isOpen ? "1" : undefined}>
              <div className="overflow-hidden">
                <div id={panelId} role="region" hidden={!isOpen} className="pb-4">
                  {item.content}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
