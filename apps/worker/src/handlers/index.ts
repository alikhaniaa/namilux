import type { Handler } from "../runtime";
import { smsSend } from "./sms-send";
import { telegramNotify } from "./telegram-notify";
import { reservationExpire } from "./reservation-expire";
import { orderExpire } from "./order-expire";
import { stockBackInStock } from "./stock-back-in-stock";
import { mediaProcess } from "./media-process";
import { ogGenerate } from "./og-generate";
import { cacheRevalidate } from "./cache-revalidate";
import { cdnPurge } from "./cdn-purge";
import { metricsRollup } from "./metrics-rollup";
import { loyaltyExpire } from "./loyalty-expire";
import { loyaltyTiers } from "./loyalty-tiers";
import { consistencyStock } from "./consistency-stock";
import { backupReport } from "./backup-report";
import { smsCampaign } from "./sms-campaign";
import { seoCrawl } from "./seo-crawl";
import { paymentSettle } from "./payment-settle";
import { jobsPrune } from "./jobs-prune";
export const handlers: Record<string, Handler> = {
  "sms.send": smsSend, "telegram.notify": telegramNotify, "reservation.expire": reservationExpire, "order.expire": orderExpire,
  "stock.back_in_stock": stockBackInStock, "media.process": mediaProcess, "og.generate": ogGenerate, "cache.revalidate": cacheRevalidate,
  "cdn.purge": cdnPurge, "metrics.rollup": metricsRollup, "loyalty.expire": loyaltyExpire, "loyalty.tiers": loyaltyTiers,
  "consistency.stock": consistencyStock, "backup.report": backupReport, "sms.campaign": smsCampaign, "seo.crawl": seoCrawl,
  "payment.settle": paymentSettle, "jobs.prune": jobsPrune,
};
