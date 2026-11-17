const VARIABLES: Record<string, string> = {
  code: "کد", sefaresh: "شماره سفارش", site: "نشانی سایت", eta: "روزهای تحویل", carrier: "شرکت حمل",
  tracking: "کد رهگیری", name: "نام کالا", answer: "پاسخ", tier: "سطح مشتری", benefits: "مزایا",
  url: "نشانی", text: "متن پیام", unsub: "نشانی لغو عضویت",
};
export const smsVariableLabel = (key: string): string => VARIABLES[key] ?? "مقدار خودکار";
export function displaySmsTemplate(text: string): string {
  return text.replace(/\{([a-zA-Z_]+)\}/g, (token: string, key: string) => VARIABLES[key] ? `{${VARIABLES[key]}}` : token);
}
export function storedSmsTemplate(text: string): string {
  const reverse = Object.fromEntries(Object.entries(VARIABLES).map(([key, label]) => [label, key]));
  return text.replace(/\{([^{}]+)\}/g, (token: string, label: string) => reverse[label] ? `{${reverse[label]}}` : token);
}
