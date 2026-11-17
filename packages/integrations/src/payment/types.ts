export type { PaymentDriver, PaymentCart, PaymentCartItem, PaymentRequestInput, PaymentRequestResult, PaymentVerifyResult } from "@namilux/core/orders/payments";
export type PaymentConfig = {
  driver: "mock" | "zarinpal" | "snapppay";
  zarinpal?: { merchantId: string; sandbox: boolean; accessToken?: string; terminalId?: string };
  snapppay?: { baseUrl: string; clientId: string; clientSecret: string; username: string; password: string; category?: string };
  siteOrigin: string;
};
