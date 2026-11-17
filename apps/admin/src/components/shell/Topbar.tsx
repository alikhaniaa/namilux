"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Menu, Search, UserRound } from "lucide-react";
import { Logout } from "./Logout";
import { RevalidateStatus } from "./RevalidateStatus";
import { SIDEBAR_EVENT } from "./Sidebar";
import { Dialog, Menu as Menu2 } from "@/components/kit-client";
import { Avatar, Input } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { api } from "@/lib/api-client";

type Hit = { href: string; label: string; hint: string; group: "products" | "orders" | "customers" };

export function Topbar({
  staffName,
  roleLabel,
  stores,
  can,
}: {
  staffName: string;
  roleLabel: string;
  stores: { href: string; label: string; site: "main" | "instalments" }[];
  can: { products: boolean; orders: boolean; customers: boolean; cache: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearchFailed(false);
    if (timer.current !== null) clearTimeout(timer.current);
    const term = q.trim();
    if (term === "") {
      setHits([]);
      setSearching(false);
      return;
    }
    setHits([]);
    setSearching(true);
    timer.current = setTimeout(() => {
      void (async () => {
        const out: Hit[] = [];
        const enc = encodeURIComponent(term);
        const tasks: Promise<void>[] = [];
        let failed = false;
        if (can.products) {
          tasks.push(
            api<{ rows: { id: number; displayName: string; brandName: string | null }[] }>(`/api/products?q=${enc}&pageSize=5`)
              .then((r) => {
                for (const p of r.rows) out.push({ href: `/products/${String(p.id)}`, label: p.displayName, hint: p.brandName ?? "", group: "products" });
              })
              .catch(() => { failed = true; }),
          );
        }
        if (can.orders) {
          tasks.push(
            api<{ items: { code: string; customerName: string | null; phoneMasked: string }[] }>(`/api/orders?q=${enc}`)
              .then((r) => {
                for (const o of r.items.slice(0, 5)) out.push({ href: `/orders/${o.code}`, label: o.code, hint: o.customerName ?? o.phoneMasked, group: "orders" });
              })
              .catch(() => { failed = true; }),
          );
        }
        if (can.customers) {
          tasks.push(
            api<{ items: { id: string; name: string | null; phoneMasked: string }[] }>(`/api/customers?q=${enc}`)
              .then((r) => {
                for (const c of r.items.slice(0, 5)) out.push({ href: `/customers/${c.id}`, label: c.name ?? c.phoneMasked, hint: c.phoneMasked, group: "customers" });
              })
              .catch(() => { failed = true; }),
          );
        }
        await Promise.all(tasks);
        if (cancelled) return;
        setHits(out);
        setSearchFailed(failed);
        setSearching(false);
        setActive(0);
      })();
    }, 200);
    return () => { cancelled = true; if (timer.current !== null) clearTimeout(timer.current); };
  }, [q, open, can]);

  const go = (h: Hit | undefined): void => {
    if (h === undefined) return;
    setOpen(false);
    setQ("");
    router.push(h.href);
  };

  const groupLabel: Record<Hit["group"], string> = {
    products: fa["shell.results.products"],
    orders: fa["shell.results.orders"],
    customers: fa["shell.results.customers"],
  };

  return (
    <header className="workspace-topbar">
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon lg:hidden" aria-label={fa["shell.menu"]} onClick={() => window.dispatchEvent(new Event(SIDEBAR_EVENT))}>
        <Menu size={20} aria-hidden="true" />
      </button>
      <button type="button" className="workspace-topbar__search" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-2">
          <Search size={16} aria-hidden="true" />
          {fa["shell.searchShort"]}
        </span>
        <kbd>Ctrl K</kbd>
      </button>
      <RevalidateStatus canRetry={can.cache} />
      <div className="workspace-topbar__end">
        {stores.map((s) => (
          <a key={s.site} href={s.href} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--ghost ui-btn--sm workspace-topbar__store" title={`${fa["shell.viewStore"]} ${s.label}`}>
            <span className="site-dot" data-site={s.site} aria-hidden="true" />
            {s.label}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ))}
        <Menu2
          label={fa["shell.account"]}
          trigger={
            <span className="workspace-topbar__user">
              <Avatar name={staffName} />
              <span className="workspace-topbar__user-name">
                <b>{staffName}</b>
                <small>{roleLabel}</small>
              </span>
              <ChevronDown size={15} aria-hidden="true" className="text-ink-3" />
            </span>
          }
        >
          <div className="ui-menu__head">
            <b>{staffName}</b>
            {roleLabel}
          </div>
          <Link href="/account">
            <UserRound size={16} aria-hidden="true" />
            {fa["shell.account"]}
          </Link>
          <div className="ui-menu__sep" />
          <Logout menu />
        </Menu2>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title={fa["common.search"]}>
        <Input
          autoFocus
          placeholder={fa["shell.search"]}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((i) => Math.min(hits.length - 1, i + 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
            else if (e.key === "Enter") go(hits[active]);
          }}
        />
        <ul className="search-hits">
          {searching ? <li role="status" className="search-hits__empty">{fa["common.loading"]}</li> : null}
          {searchFailed ? <li role="alert" className="search-hits__empty">بخشی از جستجو انجام نشد. اتصال را بررسی کنید و دوباره نام یا شماره را بنویسید.</li> : null}
          {!searching && !searchFailed && hits.length === 0 && q.trim() !== "" ? <li className="search-hits__empty">{fa["shell.noResults"]}</li> : null}
          {hits.map((h, i) => (
            <li key={`${h.group}-${h.href}`}>
              <button type="button" className="search-hit" data-active={i === active || undefined} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                <span className="search-hit__group">{groupLabel[h.group]}</span>
                <span className="search-hit__label">{h.label}</span>
                <span className="search-hit__hint">{h.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </header>
  );
}
