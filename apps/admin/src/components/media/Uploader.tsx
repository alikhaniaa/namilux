"use client";
import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, apiUpload } from "@/lib/api-client";

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,video/mp4";
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The POST /api/media/upload envelope. The route answers 202 with `{ mediaId, status: "processing" }`
 * (or `{ mediaId, status: "ready", duplicate: true }` for bytes it already has) - never `{ id }`.
 */
export type UploadResult = { mediaId: string; status: "processing" | "ready"; duplicate?: boolean };

export function Uploader({ compact = false, onUploaded }: { compact?: boolean; onUploaded?: (ids: string[]) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  function resetInput(): void {
    if (input.current !== null) input.current.value = "";
  }

  async function send(files: FileList | File[]): Promise<void> {
    // Grab the File objects first, then clear the input immediately: they stay valid, and re-picking the
    // very same file must fire `change` again so a failed upload can be retried without a page reload.
    const list = Array.from(files);
    resetInput();
    if (list.length === 0) return;
    setBusy(true);
    const ids: string[] = [];
    try {
      for (const [i, file] of list.entries()) {
        setProgress(`${String(i + 1)}/${String(list.length)}`);
        if (file.size > MAX_BYTES || !ACCEPT.split(",").includes(file.type)) {
          toast(fa["media.rejected"].replace("{reason}", file.name), "error");
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        form.append("filename", file.name);
        try {
          const r = await apiUpload<UploadResult>("/api/media/upload", form);
          if (typeof r.mediaId !== "string" || r.mediaId === "") throw new ApiError("INTERNAL", "پاسخ نامعتبر از سرور");
          ids.push(r.mediaId);
        } catch (e) {
          // Per-file failure: one rejected file must not abort the rest of the batch.
          toast(fa["media.rejected"].replace("{reason}", e instanceof ApiError ? e.message : file.name), "error");
        }
      }
      if (ids.length > 0) {
        toast(fa["media.uploaded"]);
        onUploaded?.(ids);
      }
    } finally {
      setBusy(false);
      setProgress(null);
      resetInput();
    }
  }

  const picker = <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void send(e.target.files ?? [])} />;

  if (compact) {
    return (
      <>
        {picker}
        <Button size="sm" variant="outline" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
          {busy ? (progress ?? fa["common.loading"]) : fa["media.upload"]}
        </Button>
      </>
    );
  }

  return (
    <div
      className="media-drop"
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => {
        if (!busy) input.current?.click();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy) void send(e.dataTransfer.files);
      }}
    >
      {picker}
      <span className="media-drop__icon" aria-hidden="true">
        {busy ? <span className="ui-spinner" /> : <UploadCloud size={22} />}
      </span>
      <span className="media-drop__title">{busy ? (progress ?? fa["common.loading"]) : fa["media.dropzone"]}</span>
      <span className="media-drop__hint">{fa["media.uploadHint"]}</span>
    </div>
  );
}
