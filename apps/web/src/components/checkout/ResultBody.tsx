import { faInt, payUrl } from "@namilux/core/client";
import { t } from "@/i18n";
import { Button } from "@/components/ui/Button";

export function ResultBody({ ok, code, test, eta, whatsappHref, storeAddress, canRetry, pending = false }: { ok: boolean; code: string; test: boolean; eta?: { min: number; max: number }; whatsappHref: string; storeAddress: string; canRetry: boolean; pending?: boolean }): React.ReactNode {
  void storeAddress;
  if (pending) return <div className="flex flex-col items-center gap-4 text-center pt-8" role="status">
    <h1 className="d-2 text-ink">پرداخت در حال بررسی است</h1>
    <p className="t-body text-ink-2">نتیجه نهایی هنوز از اسنپ‌پی دریافت نشده است. لطفاً دوباره پرداخت نکنید؛ وضعیت سفارش پس از تأیید به‌روز می‌شود.</p>
    <Button variant="primary" href={`/account/orders/${encodeURIComponent(code)}/`}>مشاهده وضعیت سفارش</Button>
  </div>;

  if (ok) {
    return (
      <div className="flex flex-col items-center gap-4 text-center pt-8">
        <h1 className="d-2 text-ink">{t("result.ok.title")}</h1>
        <p className="t-body text-ink">{t("result.ok.code", { code })}</p>
        {test ? <p className="t-caption text-accent">{t("result.test")}</p> : null}
        {eta !== undefined ? <p className="t-body text-ink-2">{t("result.ok.next", { min: faInt(eta.min), max: faInt(eta.max) })}</p> : null}
        <div className="flex gap-3">
          <Button variant="primary" href={`/account/orders/${encodeURIComponent(code)}/`}>{t("result.ok.view")}</Button>
          <Button variant="quiet" href="/shop/">{t("result.ok.continue")}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 text-center pt-8">
      <h1 className="d-2 text-ink">{t("result.fail.title")}</h1>
      <p className="t-body text-ink-2">{t("result.fail.body")}</p>
      <div className="flex gap-3">
        {/* the spec: retry pays the SAME pending order on its pay page (the cart was consumed at place). */}
        {canRetry ? <Button variant="primary" href={payUrl(code)}>{t("result.fail.retry")}</Button> : null}
        <a className="link-under t-body" href={whatsappHref} target="_blank" rel="noreferrer">{t("result.whatsapp")}</a>
      </div>
    </div>
  );
}
