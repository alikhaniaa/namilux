"use client";
import { mediaKindLabel, mediaSourceLabel, entityLabel } from "@/i18n/admin-labels";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt } from "@namilux/core/client";
import type { ImageRef, Renditions } from "@namilux/core/client";
import { Button, Card, Field, Input, StatusBadge } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";
import { adminMedia } from "@/lib/media";
import { quarantineReasonFa } from "@/lib/quarantine-reason";

export type MediaDetailData = {
  id: string;
  kind: string;
  storageKey: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  source: string;
  quarantined: boolean;
  reason: string | null;
  processed: boolean;
  image: ImageRef | null;
  createdAt: string;
  normalize: { subjectH?: number; widthBound?: boolean; quarantined?: boolean; reason?: string | null } | null;
  renditions: Renditions | null;
  usages: { entity: string; id: number; name: string }[];
};

const USAGE_HREF: Record<string, (id: number) => string> = {
  product: (id) => `/products/${String(id)}`,
  brand: (id) => `/brands/${String(id)}`,
  collection: (id) => `/collections/${String(id)}`,
  banner: () => "/marketing/banners",
  post: (id) => `/content/posts/${String(id)}`,
};

export function MediaDetail({ media }: { media: MediaDetailData }) {
  const router = useRouter();
  const [alt, setAlt] = useState(media.alt);
  const [busy, setBusy] = useState(false);

  async function saveAlt(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/media/${media.id}`, { method: "PUT", body: { alt } });
      toast(fa["common.saved"]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    try {
      await api(`/api/media/${media.id}`, { method: "DELETE" });
      toast(fa["media.deleted"]);
      router.push("/media");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  const renditionRows = media.renditions === null ? [] : (["avif", "webp"] as const).flatMap((fmt) => Object.entries(media.renditions?.[fmt] ?? {}).map(([w, key]) => ({ fmt, w, key })));

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
      <Card>
        <div className="bg-[var(--plate)]">
          {media.kind === "image" ? <img src={adminMedia(media.storageKey)} alt={media.alt} className="mx-auto max-h-[480px] object-contain" /> : <p className="p-6 text-center text-sm">{mediaKindLabel(media.kind)}</p>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-xs">
          <dt className="text-[var(--ink-2)]">{fa["media.dimensions"]}</dt>
          <dd className="tabular-nums">{media.width !== null && media.height !== null ? `${faInt(media.width)}×${faInt(media.height)}` : fa["common.none"]}</dd>
          <dt className="text-[var(--ink-2)]">{fa["media.size"]}</dt>
          <dd className="tabular-nums">{faInt(Math.round(media.bytes / 1024))} کیلوبایت</dd>
          <dt className="text-[var(--ink-2)]">{fa["media.source"]}</dt>
          <dd>{mediaSourceLabel(media.source)}</dd>
          <dt className="text-[var(--ink-2)]">نوع فایل</dt>
          <dd className="ltr">{mediaKindLabel(media.kind)}</dd>
          <dt className="text-[var(--ink-2)]">{fa["common.status"]}</dt>
          <dd>{media.quarantined ? <StatusBadge tone="warn">{fa["media.quarantined"]}</StatusBadge> : media.processed ? <StatusBadge tone="ok">{fa["health.ok"]}</StatusBadge> : <StatusBadge tone="muted">{fa["media.pending"]}</StatusBadge>}</dd>
        </dl>
      </Card>
      <div className="space-y-4">
        <Card title={fa["media.alt"]}>
          <Field label={fa["media.alt"]}>
            <Input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
          </Field>
          <Button className="mt-2" disabled={busy || alt === media.alt} onClick={() => void saveAlt()}>
            {fa["common.save"]}
          </Button>
        </Card>
        <Card title={fa["media.metrics"]}>
          {media.normalize === null ? (
            <p className="text-xs text-[var(--ink-2)]">{fa["common.none"]}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-1 text-xs">
              <dt className="text-[var(--ink-2)]">{fa["media.subjectH"]}</dt>
              <dd className="tabular-nums">{media.normalize.subjectH === undefined ? fa["common.none"] : `٪${faInt(Math.round(media.normalize.subjectH * 100))}`}</dd>
              <dt className="text-[var(--ink-2)]">{fa["media.widthBound"]}</dt>
              <dd>{media.normalize.widthBound === true ? fa["common.yes"] : fa["common.no"]}</dd>
              <dt className="text-[var(--ink-2)]">{fa["media.reason"]}</dt>
              <dd>{quarantineReasonFa(media.normalize.reason) ?? fa["common.none"]}</dd>
            </dl>
          )}
        </Card>
        <Card title={fa["media.renditions"]}>
          {renditionRows.length === 0 ? (
            <p className="text-xs text-[var(--ink-2)]">{fa["common.none"]}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1 text-[11px]">
              {renditionRows.map((r) => (
                <li key={`${r.fmt}-${r.w}`}>
                  <a className="ltr hover:text-[var(--accent)]" href={adminMedia(r.key)} target="_blank" rel="noreferrer">
                    تصویر با عرض {faInt(Number(r.w))} پیکسل
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={fa["media.usage"]}>
          {media.usages.length === 0 ? (
            <p className="text-xs text-[var(--ink-2)]">{fa["media.noUsage"]}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {media.usages.map((u) => (
                <li key={`${entityLabel(u.entity)}-${String(u.id)}`}>
                  <Link href={USAGE_HREF[u.entity]?.(u.id) ?? "/media"} className="hover:text-[var(--accent)]">
                    <span className="me-2 text-xs text-[var(--ink-3)]">{entityLabel(u.entity)}</span>
                    {u.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ConfirmButton label={fa["common.delete"]} confirmLabel={fa["media.delete.confirm"]} disabled={media.usages.length > 0} onConfirm={remove} />
          </div>
        </Card>
      </div>
    </div>
  );
}
