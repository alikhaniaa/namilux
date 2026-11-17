"use client";
import { searchUrl } from "@namilux/core/client";
import type { NavBrand, NavCollection } from "@namilux/core";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchIdle } from "@/components/search/SearchIdle";
import { SEARCH_INPUT_ID, SEARCH_LISTBOX_ID, SearchResults } from "@/components/search/SearchResults";
import { useSearchIndex } from "@/components/search/useSearchIndex";
import { FocusTrap } from "@/components/ui/FocusTrap";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

/** the spec - results follow the typing, they do not race it. */
const DEBOUNCE_MS = 120;

const NO_FREQUENT: string[] = [];

// The overlay family shares one portal node; it is created on first open (see Sheet.tsx for the
// reasoning - app/layout.tsx is another file's contract). Portalling to <body> also keeps the panel
// out of the header's stacking context and out of its `md:hidden` / `hidden md:flex` rows.
function sheetsRoot(): HTMLElement {
  const existing = document.getElementById("sheets");
  if (existing !== null) return existing;
  const created = document.createElement("div");
  created.id = "sheets";
  document.body.append(created);
  return created;
}

export function SearchOverlay({
  open,
  onClose,
  frequent = NO_FREQUENT,
  brands,
  collections,
  variant = "icon",
}: {
  open?: boolean;
  // DECISION: spelled as a property, not the header's `onClose(): void` method shorthand - the type
  // is identical, and a method-shorthand prop trips `@typescript-eslint/unbound-method`.
  onClose?: () => void;
  frequent?: string[];
  brands: NavBrand[];
  collections: NavCollection[];
  /**
   * `icon` - the phone's 44 px button. `bar` - the header's second tier: a quiet field-shaped
   * affordance with the placeholder as its visible (and accessible) name, so the browse row has a
   * weight at its inline end instead of dead graphite.
   */
  variant?: "icon" | "bar";
}): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(false);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const isOpen = open ?? internalOpen;

  const close = (): void => {
    setQuery("");
    setDebounced("");
    if (onClose === undefined) setInternalOpen(false);
    else onClose();
  };

  // Kept in a ref so the navigation effect below never re-runs when the query changes.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // The index is fetched on first open, never on page load. A failed
  // or empty index is not an error the reader has to read: the overlay stays on its idle state.
  const { index, error } = useSearchIndex(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    setRoot(sheetsRoot());
  }, [isOpen]);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(query);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [query]);

  // Opening a result navigates but does not unmount the overlay (it lives in a portal), so the route
  // change closes it - this covers both a click on a row and Enter on the active one.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    closeRef.current();
  }, [pathname]);

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const q = query.trim();
    if (q === "") return;
    close();
    router.push(searchUrl(q));
  };

  const indexUnusable = error || (index !== null && index.length === 0);
  const showResults = debounced.trim() !== "" && !indexUnusable;

  return (
    <>
      {/* The bar variant's visible text IS its accessible name (WCAG 2.5.3), so it carries no
          aria-label; the icon variant has no text and keeps one. */}
      <button
        type="button"
        aria-label={variant === "bar" ? undefined : t("a11y.openSearch")}
        aria-expanded={isOpen}
        className={variant === "bar" ? "site-search-cue" : "icon-btn"}
        onClick={() => {
          setInternalOpen(true);
        }}
      >
        <Icon name="search" size={variant === "bar" ? 20 : 24} />
        {variant === "bar" ? <span>{t("shell.search.placeholder")}</span> : null}
      </button>

      {!isOpen || root === null
        ? null
        : createPortal(
            <FocusTrap active onEscape={close}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label={t("search.title")}
                className="search-takeover bg-surface fixed inset-0 z-50 flex flex-col"
              >
                {/* the spec: a 56 px field with a --line-strong bottom rule and no box at all - 
                    no border, and the focus ring is left alone (it is the only visible focus state a
                    keyboard reader gets on the field). `aria-controls` is written only while the
                    listbox exists, so it never dangles. */}
                <div className="search-bar border-line-strong border-b">
                  <form className="wrap flex h-14 items-center gap-3" role="search" onSubmit={submit}>
                    <Icon name="search" size={20} className="text-ink-3 shrink-0" />
                    <input
                      ref={inputRef}
                      id={SEARCH_INPUT_ID}
                      type="search"
                      role="combobox"
                      aria-expanded={showResults}
                      aria-controls={showResults ? SEARCH_LISTBOX_ID : undefined}
                      aria-autocomplete="list"
                      aria-label={t("shell.search")}
                      placeholder={t("shell.search.placeholder")}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="search"
                      className="search-input text-ink h-14 grow border-0 bg-transparent"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                      }}
                    />
                    {query === "" ? null : <button type="button" className="icon-btn text-ink-2" aria-label={t("search.clear")} onClick={() => {
                      setQuery("");
                      setDebounced("");
                      inputRef.current?.focus();
                    }}><Icon name="close" size={20} /></button>}
                    <button
                      type="button"
                      onClick={close}
                      aria-label={t("shell.close")}
                      className="text-ink-2 -me-2 grid size-[44px] shrink-0 place-items-center"
                    >
                      <span className="t-sm">{t("shell.close")}</span>
                    </button>
                  </form>
                </div>

                <div className="grow overflow-y-auto overscroll-contain">
                  <div className="wrap">
                    {showResults ? (
                      <SearchResults q={debounced} brands={brands} collections={collections} />
                    ) : (
                      <SearchIdle
                        frequent={frequent}
                        brands={brands}
                        collections={collections}
                        onPick={(picked) => {
                          setQuery(picked);
                          setDebounced(picked);
                        }}
                      />
                    )}
                  </div>
                  {/* DECISION: the overlay is opaque porcelain, so there is no scrim to click - this
                      empty tail below the content plays that role ("Esc/scrim closes"); it is inert
                      to assistive tech because Esc and the close button are the announced ways out. */}
                  <div aria-hidden="true" className="min-h-24" onClick={close} />
                </div>
              </div>
            </FocusTrap>,
            root,
          )}
    </>
  );
}
