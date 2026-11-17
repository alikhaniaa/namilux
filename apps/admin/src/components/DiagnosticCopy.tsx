"use client";
import { Button } from "./kit";
import { toast } from "./kit-client";

/** Support can still receive exact diagnostics without exposing raw payloads in the panel. */
export function DiagnosticCopy({ data }: { data: unknown }) {
  return <Button size="sm" variant="ghost" onClick={() => {
    void navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(
      () => toast("گزارش برای پشتیبانی کپی شد."),
      () => toast("کپی انجام نشد. دسترسی مرورگر به کپی کردن را بررسی کنید و دوباره تلاش کنید.", "error"),
    );
  }}>کپی گزارش برای پشتیبانی</Button>;
}
