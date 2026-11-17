import { listNotFound } from "@namilux/core";
import type { Handler } from "../runtime";

const NOTFOUND_ALERT_HITS = 20;

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

export const seoCrawl: Handler = async ({ db, drivers, env, log, job }) => {
  const mode = (job.payload as { mode?: string }).mode ?? "notfound-digest";
  if (mode !== "notfound-digest") {
    log.info({ mode }, "seo.crawl: parity handled by the standalone tool (M6); nothing to do");
    return;
  }

  const page = await listNotFound(db, { days: 1, page: 1 });
  const totalHits = page.items.reduce((sum, r) => sum + r.hits, 0);
  const siteHost = hostOf((env.SITE_ORIGIN) ?? "");
  const external = page.items.filter((r) =>
    r.referrers.some((ref) => {
      const h = hostOf(ref);
      return h !== "" && h !== siteHost;
    }),
  );

  if (totalHits <= NOTFOUND_ALERT_HITS && external.length === 0) {
    log.info({ totalHits, paths: page.items.length }, "seo.crawl: 404s below threshold");
    return;
  }

  if (!drivers.telegram.enabled) {
    log.warn({ totalHits, external: external.length }, "seo.crawl: 404 digest over threshold but Telegram disabled");
    return;
  }
  const top = page.items.slice(0, 10).map((r) => `• ${r.path} (${r.hits})`).join("\n");
  const text = `📉 <b>گزارش ۴۰۴ دیروز</b> — ${totalHits} بازدید روی ${page.items.length} مسیر${external.length > 0 ? ` — ${external.length} با ارجاع بیرونی` : ""}\n${top}`;
  const ok = await drivers.telegram.send(text);
  if (!ok) throw new Error("telegram digest send failed");
  log.info({ totalHits, external: external.length }, "seo.crawl: 404 digest sent");
};
