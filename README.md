# namilux

Storefront and back office for a home-appliance retailer in Tehran (namilux.ir). Persian, right-to-left, prices in Toman, login by one-time SMS code, card and instalment payment gateways, installable as a PWA. It replaced the shop's earlier WordPress site and keeps all 752 of its public URLs working, either served or redirected.

Built in August to October 2026 as a freelance project for the client, and running in production since September 2026. Published in 2026 as a code sample. The client's business data, a crawl of the old site, server details and operating notes are not included.

## What it does

- Customers: catalogue with filters and search, product pages, cart, checkout, order tracking, account area, loyalty tiers, back-in-stock alerts, contact and "concierge" requests.
- Staff: back office for products, stock, prices, orders, refunds, customers, content, menus, banners, SMS campaigns and reports. Staff log in with password and TOTP.
- Background jobs: SMS sending, image renditions, cache revalidation, order and reservation expiry, payment settlement retries, analytics roll-ups.

## Architecture

```
            browser (mobile first)
                    |
                 Caddy  (TLS, HTTP/3, static media, body-size and slow-client limits)
              /           \
   apps/web (:3000)    apps/admin (:3100)        apps/worker (:3200 health only)
   storefront          back office               job runner and scheduler
        \                  |                       /
         +---------- packages/core ---------------+    domain logic: pricing, orders,
                           |                            inventory, auth, catalogue, SEO
                     packages/db (Drizzle)
                           |
                  PostgreSQL 16  (one database role per app; jobs table, no broker)

   packages/integrations: payment (ZarinPal, SnappPay, mock), SMS (several providers, mock),
                          storage, CDN purge, Telegram alerts, captcha
   packages/config:       environment schema (zod); refuses a production start with mock drivers
   infra/server:          provisioning, release, rollback, backup, restore, watchdog, systemd units
```

There is no Redis, message broker or CMS. The job queue lives in PostgreSQL. A second storefront instance for instalment purchases runs from the same source with its own origin and payment gateway.

## Stack

Node 24, pnpm workspaces, TypeScript (strict), Next.js 16 (App Router), React, PostgreSQL 16 with Drizzle and reviewed SQL migrations, zod, Vitest, Playwright, Caddy, systemd on one Ubuntu VPS, Bash for the server kit.

## My role

I built this for the client as a freelance project: requirements with the shop owner, architecture, implementation, deployment to the client's server and operation after launch. Much of the code was written with AI coding assistants working under my direction.

## Run it locally

Requirements: Node 24 or newer, pnpm 10 (`corepack enable`), PostgreSQL 16.

```bash
pnpm install
cp .env.example .env.local      # fill DATABASE_URL_* and the 64-hex secrets (openssl rand -hex 32)
pnpm db:migrate && pnpm db:roles
pnpm dev                        # web :3000, admin :3100, worker
```

`pnpm db:seed` imports the old site from `data/extract/`, which is not in this repository, so a fresh database starts empty. Create the first staff account with `pnpm admin:create-owner`.

Checks:

```bash
pnpm typecheck && pnpm lint
pnpm check:forbidden     # project rules: no left/right CSS, no Latin digits in UI copy, no raw HTML sinks
pnpm test                # Vitest; database tests need DATABASE_URL_TEST
pnpm --filter @namilux/tests test   # security suite: CSRF, rate limits, OTP abuse, price tampering, callback forgery
```

## Measured on the production server

From the release notes of 20 September 2026 (2 vCPU, 4 GB RAM VPS; requests sent over loopback to the origin, so this excludes Internet latency, image delivery and checkout):

| Workload | Rate | Requests | Errors | Median | 95th percentile |
|---|---:|---:|---:|---:|---:|
| Product and listing pages | 20 requests/s | 1,200 | 0 | 10 ms | 42 ms |
| Listing with varied price and sort filters | 5 requests/s | 300 | 0 | 30 ms | 47 ms |

## What is not included or not finished

- `data/extract/` (crawl of the old WordPress site) is left out. The seed importer, the 752-URL contract check and some unit tests read it, so they fail or skip without it. For that reason the CI workflow in `.github/workflows/ci.yml` only runs when started by hand.
- Product photography and the client's operating documents are left out.
- Payment gateways and SMS providers need real merchant accounts; without them the mock drivers are used, which production mode refuses.

## Licence

No licence is granted. The code was written for a client; it is published as a work sample only.
