"use client";
import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function CacheTools() {
  const [tags, setTags] = useState("catalog");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      toast(fa["cache.done"]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <Card title={fa["cache.revalidate"]}>
        <Field label="بخش سایت">
          <Select value={tags} onChange={e => setTags(e.target.value)}>
            <option value="catalog">کالاها و قیمت‌ها</option>
            <option value="settings">تنظیمات فروشگاه</option>
            <option value="content">مطالب و صفحه‌ها</option>
            <option value="sitemap">فهرست نشانی‌های سایت</option>
            <option value="nav">منوهای سایت</option>
            <option value="home">صفحهٔ نخست</option>
            {!['catalog', 'settings', 'content', 'sitemap', 'nav', 'home'].includes(tags) ? <option value={tags}>بخش تعیین‌شده توسط پشتیبانی</option> : null}
          </Select>
        </Field>
        <details className="mt-3 text-xs"><summary className="cursor-pointer">تعیین بخش با راهنمایی پشتیبانی</summary><Field label="عبارت دریافتی از پشتیبانی"><Input dir="ltr" value={tags} onChange={e => setTags(e.target.value)} /></Field></details>
        <Button className="mt-3" disabled={busy || tags.trim() === ""} onClick={() => void run(() => api("/api/cache/revalidate", { method: "POST", body: { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } }))}>
          {fa["cache.revalidate"]}
        </Button>
      </Card>
      <Card title={fa["cache.purgeUrl"]}>
        <Field label="نشانی صفحه">
          <Input dir="ltr" placeholder="/product/…/" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || url.trim() === ""} onClick={() => void run(() => api("/api/cache/purge", { method: "POST", body: { urls: [url.trim()] } }))}>
            {fa["cache.purgeUrl"]}
          </Button>
          <ConfirmButton label={fa["cache.purgeAll"]} confirmLabel={fa["cache.purgeAll.confirm"]} disabled={busy} onConfirm={() => run(() => api("/api/cache/purge", { method: "POST", body: { all: true } }))} />
        </div>
      </Card>
    </div>
  );
}
