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
```

In development `npm run dev:web` proxies `/api` to the API on :4000, so `/app` works there too.

Schema lives in `apps/api/src/db/schema.ts`. After changing it: `npm run db:generate`, review the SQL in `apps/api/drizzle/`, then `npm run db:migrate`.

## Where things live

| What | Where |
| --- | --- |
| Design tokens (colours, radii, motion) | `apps/web/src/styles/tokens.css` |
| All prices | `apps/web/src/data/pricing.ts` |
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
