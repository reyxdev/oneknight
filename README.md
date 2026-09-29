# ONEKNIGHT

Public website and interactive ONEKNIGHT demo. Next.js (App Router, static export), React, TypeScript, Tailwind v4.
Architecture, design system and decisions: [ARCHITECTURE.md](ARCHITECTURE.md). Owner inputs still missing: [TODO.md](TODO.md).

## Structure (npm workspaces)

| Path | What |
| --- | --- |
| `apps/web` | Public site oneknight.pro (and later the panel at `/app`) |
| `apps/api` | ONEKNIGHT server: Fastify, PostgreSQL, Drizzle (`/api/*`) |
| `packages/domain` | Domain model shared by web and api (`@oneknight/domain`) |

## Run

```bash
npm install
npm run dev:web      # http://localhost:3000
npm run build        # static site in apps/web/out/
npm run start:web    # serves apps/web/out/ on http://localhost:4173
npm run test:e2e     # needs start:web running; CHROMIUM=/path/to/chromium if not /usr/bin/chromium
npm run typecheck    # all workspaces
```

### Server and database (local)

```bash
cp .env.example .env # then set a real POSTGRES_PASSWORD and the same one in DATABASE_URL
npm run db:up        # PostgreSQL 17 in Docker on 127.0.0.1:5433 (container oneknight-db)
npm run db:migrate   # apply migrations from apps/api/drizzle
npm run dev:api      # http://127.0.0.1:4000/api/health
npm run test:api
```

### Whole product locally (site + account + API, same origin like production)

```bash
npm run build        # static site, including /app
npm run start -w @oneknight/api
npm run serve        # http://127.0.0.1:8080  (/app = ONEKNIGHT account)
npm run test:app -w @oneknight/web   # real account flow in a browser
node apps/web/tests/site-e2e.mjs      # admin adds a site, client sees monitoring (probes example.com)
node apps/web/tests/billing-e2e.mjs   # trial, IBAN top-up, admin confirmation (API started with test PAYMENT_* values)
node apps/web/tests/support-e2e.mjs   # support request with screenshot, admin reply
node apps/web/tests/shop-e2e.mjs      # products, public API order, statuses
node apps/web/tests/reviews-e2e.mjs   # reviews module, moderation, PNG creative
node apps/web/tests/analytics-e2e.mjs # tracking script on a simulated client site, sources report
node apps/web/tests/team-e2e.mjs      # invitation link, permissions, business switcher
node apps/web/tests/appearance-e2e.mjs # live customisation applied on a simulated client site
```

Public API for client websites: [docs/public-api.md](docs/public-api.md).

In development `npm run dev:web` proxies `/api` to the API on :4000, so `/app` works there too.

Make an account an administrator (sees all requests in `/app`):

```bash
npm run admin:grant -w @oneknight/api -- you@example.com
```

Telegram alerts about new requests: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` (see `.env.example`).

Schema lives in `apps/api/src/db/schema.ts`. After changing it: `npm run db:generate`, review the SQL in `apps/api/drizzle/`, then `npm run db:migrate`.

## Where things live

| What | Where |
| --- | --- |
| Design tokens (colours, radii, motion) | `apps/web/src/styles/tokens.css` |
| All prices, module catalogue | `packages/domain/src/pricing.ts`, `packages/domain/src/modules.ts` |
| Contacts | `apps/web/src/data/contacts.ts` |
| Copy, Ukrainian (source of truth) / English | `apps/web/src/i18n/` |
| Karpatu.shop facts, owner testimonial slot | `apps/web/src/content/karpatu.ts` |
| Ivan's full name and portrait slot | `apps/web/src/content/about.ts` |
| ONEKNIGHT domain model / client contract | `packages/domain/src/index.ts`, `apps/web/src/features/oneknight/client.ts` |
| ONEKNIGHT demo implementation (all data fictional) | `apps/web/src/features/oneknight/demo/` |
| Module catalogue | `apps/web/src/data/modules.ts` |
| Karpatu.shop screenshots | `apps/web/public/case/karpatu/` (regenerate with `npm run images`) |

## Rules this codebase keeps

- No invented results, testimonials, metrics or integrations. Unknown values are `null` and render an honest pending state.
- Demo data is labelled as demo in the UI.
- Every control that looks interactive does something.
- The ONEKNIGHT screens depend only on the `OneKnightClient` interface; the live API replaces `createDemoClient` in `state.tsx`.
