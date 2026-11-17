-- Which storefront a price request, product question or contact message was sent from.
-- The admin answers a request from the instalment site with that site's price (never the fixed
-- price, and «انتشار قیمت» is refused for it), the customer's «درخواست‌ها» tab shows each site its
-- own requests, and the reply SMS names the site the shopper used. Every existing row came from
-- namilux.ir, which is what the default says. Additive: the running release never reads it.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "channel" "sales_channel" DEFAULT 'main' NOT NULL;
