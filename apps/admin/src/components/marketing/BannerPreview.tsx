"use client";
import { useState } from "react";
import { fa } from "@/i18n/fa";

export function BannerPreview({ title, subtitle, ctaLabel, imageUrl, imageDarkUrl, theme }: { title: string; subtitle: string | null; ctaLabel: string | null; imageUrl: string | null; imageDarkUrl: string | null; theme: "light" | "dark" | "auto" }) {
  const [mode, setMode] = useState<"mobile" | "desktop">("mobile");
  const dark = theme === "dark";
  const src = dark && imageDarkUrl !== null ? imageDarkUrl : imageUrl;
  return (
    <div className="space-y-2">
      <div className="flex gap-1 text-xs">
        <button type="button" className={`border px-2 py-0.5 ${mode === "mobile" ? "border-[var(--accent)]" : "border-[var(--line)]"}`} onClick={() => setMode("mobile")}>
          {fa["banners.preview.mobile"]}
        </button>
        <button type="button" className={`border px-2 py-0.5 ${mode === "desktop" ? "border-[var(--accent)]" : "border-[var(--line)]"}`} onClick={() => setMode("desktop")}>
          {fa["banners.preview.desktop"]}
        </button>
      </div>
      <div className={`relative overflow-hidden border border-[var(--line)] ${mode === "mobile" ? "aspect-[4/5] w-[240px]" : "aspect-[21/9] w-full"} ${dark ? "bg-[var(--ink)] text-[var(--surface)]" : "bg-[var(--bg)] text-[var(--ink)]"}`}>
        {src !== null ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="absolute inset-x-0 bottom-0 space-y-1 p-3">
          <p className={`font-semibold ${mode === "mobile" ? "text-sm" : "text-xl"}`}>{title || "…"}</p>
          {subtitle !== null && subtitle !== "" ? <p className="text-xs opacity-80">{subtitle}</p> : null}
          {ctaLabel !== null && ctaLabel !== "" ? <span className={`inline-block px-3 py-1 text-xs ${dark ? "bg-[var(--surface)] text-[var(--ink)]" : "bg-[var(--ink)] text-[var(--surface)]"}`}>{ctaLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}
