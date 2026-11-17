/** Labels at the admin boundary; stored enum values and business rules stay unchanged. */
const STATUS: Record<string, string> = {
  draft: "پیش‌نویس", active: "فعال", published: "منتشرشده", archived: "بایگانی‌شده",
  queued: "در صف", running: "در حال انجام", done: "انجام‌شده", failed: "ناموفق", dead: "متوقف‌شده",
  sent: "ارسال‌شده", delivered: "تحویل‌شده", pending: "در انتظار", answered: "پاسخ داده‌شده",
  hidden: "پنهان", waiting: "در انتظار", notified: "خبر داده‌شده", cancelled: "لغوشده",
  sending: "در حال ارسال", scheduled: "زمان‌بندی‌شده", ready: "آماده", processing: "در حال پردازش",
};
export const statusLabel = (value: string): string => STATUS[value] ?? "وضعیت نامشخص";

export const JOB_LABELS: Record<string, string> = {
  "sms.send": "ارسال پیامک", "telegram.notify": "اعلان تلگرام", "reservation.expire": "پایان رزرو موجودی",
  "order.expire": "پایان مهلت پرداخت", "stock.back_in_stock": "اطلاع‌رسانی موجود شدن کالا", "media.process": "آماده‌سازی رسانه",
  "og.generate": "ساخت تصویر اشتراک‌گذاری", "cache.revalidate": "به‌روزرسانی نمایش سایت", "cdn.purge": "تازه‌سازی فایل‌های سایت",
  "metrics.rollup": "محاسبهٔ آمار", "loyalty.expire": "پایان اعتبار امتیازها", "loyalty.tiers": "به‌روزرسانی سطح مشتریان",
  "consistency.stock": "بررسی موجودی", "backup.report": "گزارش نسخهٔ پشتیبان", "sms.campaign": "ارسال پیامک تبلیغاتی",
  "seo.crawl": "بررسی نشانی‌های سایت", "payment.settle": "تسویهٔ پرداخت", "jobs.prune": "پاک‌سازی سوابق پردازش",
  "worker.heartbeat": "بررسی فعالیت پردازشگر",
};
export const jobLabel = (value: string): string => JOB_LABELS[value] ?? "پردازش خودکار";

export const SECURITY_LABELS: Record<string, string> = {
  "otp.locked": "توقف موقت کد ورود", "otp.quota": "رسیدن به سقف کد ورود", "otp.breaker.captcha": "درخواست بررسی امنیتی",
  "otp.breaker.pause": "توقف موقت ارسال کد", "staff.login.failed": "ورود ناموفق همکار", "staff.login.locked": "توقف موقت ورود همکار",
  "staff.login.new_ip": "ورود همکار از اتصال تازه", "staff.sudo": "تأیید دوبارهٔ همکار", "csp.report": "گزارش امنیت صفحه",
  "callback.forged": "پاسخ نامعتبر درگاه", "callback.unknown_authority": "پرداخت ناشناخته", "upload.rejected": "فایل پذیرفته نشد",
  rate_limited: "درخواست بیش از حد مجاز", "csrf.rejected": "اعتبار درخواست تأیید نشد", "internal.unsigned": "درخواست داخلی تأیید نشد",
  "quote.sig_invalid": "اعتبار پیش‌فاکتور تأیید نشد", "price.tamper": "مغایرت قیمت", "stock.drift": "مغایرت موجودی",
};
export const securityLabel = (value: string): string => SECURITY_LABELS[value] ?? "رویداد امنیتی";
export const actorLabel = (value: string): string => ({ staff: "همکار فروشگاه", customer: "مشتری", system: "سامانه", worker: "پردازش خودکار", seed: "انتقال اولیه" })[value] ?? "سامانه";
export const movementLabel = (value: string): string => ({ sale: "فروش", restock: "ورود کالا", adjust: "اصلاح موجودی", return: "برگشت از مشتری", cancel: "لغو سفارش", seed: "موجودی اولیه" })[value] ?? "تغییر موجودی";
export const currencyLabel = (value: string): string => ({ EUR: "یورو", USD: "دلار آمریکا", AED: "درهم امارات", GBP: "پوند انگلیس", TRY: "لیر ترکیه", CNY: "یوان چین" })[value] ?? "ارز";
export const mediaKindLabel = (value: string): string => ({ image: "تصویر", video: "ویدئو", document: "سند", font: "قلم" })[value] ?? "فایل";
export const mediaSourceLabel = (value: string): string => ({ legacy: "فروشگاه قبلی", admin: "بارگذاری همکار", seed: "انتقال اولیه" })[value] ?? "ثبت نشده";
export const entityLabel = (value: string): string => ({ product: "کالا", brand: "برند", collection: "مجموعه", banner: "بنر", post: "مطلب", page: "صفحه", category: "دسته" })[value] ?? "محتوا";
export const robotsLabel = (value: string): string => ({
  "index, follow": "نمایش در گوگل و دنبال کردن پیوندها",
  "noindex, follow": "پنهان از گوگل، با دنبال کردن پیوندها",
  "noindex, nofollow": "پنهان از گوگل، بدون دنبال کردن پیوندها",
  "index, nofollow": "نمایش در گوگل، بدون دنبال کردن پیوندها",
})[value] ?? "تنظیمات حفظ‌شده از فروشگاه قبلی";
