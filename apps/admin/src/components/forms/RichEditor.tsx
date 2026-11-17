"use client";
/* eslint-disable namilux/no-dangerous-html -- DECISION: the rich editor is the admin's one HTML sink (contenteditable must render markup). Values are re-sanitised by core sanitizeHtml on save, the preview is a sandboxed iframe, and the storefront never renders this component. */

import { useEffect, useRef, useState } from "react";
import { MediaPicker } from "./MediaPicker";
import { Button, Field, Input, Textarea } from "@/components/kit";
import { Dialog } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { adminMedia } from "@/lib/media";

const BLOCK_TAGS = new Set(["P", "H2", "H3", "H4", "BLOCKQUOTE", "LI", "DIV"]);

function closestBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let cur: Node | null = node;
  while (cur !== null && cur !== root) {
    if (cur instanceof HTMLElement && BLOCK_TAGS.has(cur.tagName)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

export function RichEditor({ value, onChange, label, allowImages = true }: { value: string; onChange: (html: string) => void; label: string; allowImages?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"edit" | "html" | "preview">("edit");
  const [picker, setPicker] = useState(false);
  const lastEmitted = useRef(value);
  const mountedEditor = useRef<HTMLElement | null>(null);
  const linkRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (el !== null && mode === "edit" && (mountedEditor.current !== el || (el.innerHTML !== value && lastEmitted.current !== value))) {
      el.innerHTML = value;
      lastEmitted.current = value;
      mountedEditor.current = el;
    }
  }, [value, mode]);

  const emit = (): void => {
    const el = ref.current;
    if (el === null) return;
    lastEmitted.current = el.innerHTML;
    onChange(el.innerHTML);
  };

  const selection = (): Range | null => {
    const sel = window.getSelection();
    if (sel === null || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return ref.current?.contains(range.commonAncestorContainer) === true ? range : null;
  };

  const wrapInline = (tag: "STRONG" | "EM"): void => {
    const range = selection();
    if (range === null || range.collapsed) return;
    const wrapper = document.createElement(tag);
    try {
      range.surroundContents(wrapper);
    } catch {
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
    }
    emit();
  };

  const setBlock = (tag: "P" | "H2" | "H3" | "BLOCKQUOTE"): void => {
    const range = selection();
    const root = ref.current;
    if (range === null || root === null) return;
    const block = closestBlock(range.startContainer, root);
    if (block === null) {
      const p = document.createElement(tag);
      p.appendChild(range.extractContents());
      range.insertNode(p);
    } else if (block.tagName !== tag) {
      const next = document.createElement(tag);
      while (block.firstChild !== null) next.appendChild(block.firstChild);
      block.replaceWith(next);
    }
    emit();
  };

  const makeList = (ordered: boolean): void => {
    const range = selection();
    const root = ref.current;
    if (range === null || root === null) return;
    const block = closestBlock(range.startContainer, root);
    const list = document.createElement(ordered ? "ol" : "ul");
    const li = document.createElement("li");
    if (block !== null && block.tagName !== "LI") {
      while (block.firstChild !== null) li.appendChild(block.firstChild);
      block.replaceWith(list);
    } else {
      li.appendChild(range.extractContents());
      range.insertNode(list);
    }
    list.appendChild(li);
    emit();
  };

  const insertHtml = (html: string): void => {
    const range = selection();
    const root = ref.current;
    if (root === null) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    if (range === null) root.append(tpl.content);
    else {
      range.deleteContents();
      range.insertNode(tpl.content);
    }
    emit();
  };

  const link = (): void => {
    const range = selection();
    if (range === null || range.collapsed) return;
    linkRange.current = range.cloneRange();
    setLinkHref("https://");
    setLinkError("");
    setLinkOpen(true);
  };

  const applyLink = (): void => {
    const range = linkRange.current;
    const href = linkHref.trim();
    if (range === null) return;
    if (!/^(https:\/\/[^\s/]+|\/(?!\/)|mailto:|tel:)/.test(href)) {
      setLinkError("نشانی کامل صفحه را وارد کنید؛ مثلاً نشانی‌ای که از مرورگر کپی کرده‌اید.");
      return;
    }
    const a = document.createElement("a");
    a.href = href;
    try {
      range.surroundContents(a);
    } catch {
      a.appendChild(range.extractContents());
      range.insertNode(a);
    }
    emit();
    setLinkOpen(false);
  };

  const clearFormatting = (): void => {
    const range = selection();
    if (range === null) return;
    const text = range.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    emit();
  };

  const tools: { key: string; label: string; run: () => void }[] = [
    { key: "h2", label: fa["editor.h2"], run: () => setBlock("H2") },
    { key: "h3", label: fa["editor.h3"], run: () => setBlock("H3") },
    { key: "p", label: "¶", run: () => setBlock("P") },
    { key: "b", label: fa["editor.bold"], run: () => wrapInline("STRONG") },
    { key: "i", label: fa["editor.italic"], run: () => wrapInline("EM") },
    { key: "ul", label: fa["editor.ul"], run: () => makeList(false) },
    { key: "ol", label: fa["editor.ol"], run: () => makeList(true) },
    { key: "link", label: fa["editor.link"], run: link },
    { key: "quote", label: fa["editor.quote"], run: () => setBlock("BLOCKQUOTE") },
    { key: "table", label: fa["editor.table"], run: () => insertHtml("<table><thead><tr><th> </th><th> </th></tr></thead><tbody><tr><td> </td><td> </td></tr></tbody></table><p></p>") },
    { key: "clear", label: fa["editor.clear"], run: clearFormatting },
  ];

  return (
    <Field label={label} group>
      <div className="min-w-0 border border-[var(--line)]">
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] bg-[var(--bg)] p-1">
          {mode === "edit"
            ? tools.map((t) => (
                <Button key={t.key} size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={t.run}>
                  {t.label}
                </Button>
              ))
            : null}
          {mode === "edit" && allowImages ? (
            <Button size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => setPicker(true)}>
              {fa["editor.image"]}
            </Button>
          ) : null}
          <span className="ms-auto flex gap-1">
            {(["edit", "html", "preview"] as const).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "outline" : "ghost"} onClick={() => setMode(m)}>
                {m === "edit" ? fa["common.edit"] : m === "html" ? fa["editor.html"] : fa["editor.preview"]}
              </Button>
            ))}
          </span>
        </div>
        {mode === "edit" ? (
          <div
            ref={ref}
            contentEditable
            role="textbox"
            aria-label={label}
            aria-multiline="true"
            suppressContentEditableWarning
            className="prose-admin min-h-56 max-w-full overflow-x-auto break-words p-3 text-sm outline-none [&_img]:max-w-full [&_img]:h-auto"
            onInput={emit}
            onBlur={emit}
            onPaste={(e) => {
              e.preventDefault();
              insertHtml(e.clipboardData.getData("text/plain").split("\n").map((l) => `<p>${l.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)}</p>`).join(""));
            }}
          />
        ) : mode === "html" ? (
          <Textarea dir="ltr" className="min-h-56 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <iframe title={fa["editor.preview"]} sandbox="" className="min-h-56 w-full bg-[var(--surface)]" srcDoc={`<!doctype html><html dir="rtl" lang="fa"><head><style>body{font-family:sans-serif;line-height:1.9;padding:16px;max-width:64ch;color:CanvasText}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid currentColor;padding:4px 8px}</style></head><body>${value}</body></html>`} />
        )}
      </div>
      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} title={fa["editor.linkUrl"]} footer={<>
        <Button variant="outline" onClick={() => setLinkOpen(false)}>{fa["common.cancel"]}</Button>
        <Button onClick={applyLink}>{fa["common.apply"]}</Button>
      </>}>
        <Field label={fa["editor.linkUrl"]} error={linkError}>
          <Input dir="ltr" value={linkHref} onChange={e => setLinkHref(e.target.value)} />
        </Field>
      </Dialog>
      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        onSelect={(_ids, items) => {
          const m = items[0];
          if (m !== undefined) insertHtml(`<img src="${adminMedia(m.storageKey)}" alt="${m.alt.replace(/"/g, "&quot;")}" />`);
        }}
      />
    </Field>
  );
}
