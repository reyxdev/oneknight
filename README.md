# ONEKNIGHT

Public website and interactive ONEKNIGHT demo. Next.js (App Router, static export), React, TypeScript, Tailwind v4.
Architecture, design system and decisions: [ARCHITECTURE.md](ARCHITECTURE.md). Owner inputs still missing: [TODO.md](TODO.md).

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in out/
npm start            # serves out/ on http://localhost:4173
npm run test:e2e     # needs npm start running; CHROMIUM=/path/to/chromium if not /usr/bin/chromium
```

## Where things live

| What | Where |
| --- | --- |
| Design tokens (colours, radii, motion) | `src/styles/tokens.css` |
| All prices | `src/data/pricing.ts` |
| Contacts | `src/data/contacts.ts` |
| Copy, Ukrainian (source of truth) / English | `src/i18n/uk.ts`, `src/i18n/uk/*`, `src/i18n/en*` |
| Karpatu.shop facts, owner testimonial slot | `src/content/karpatu.ts` |
| Ivan's full name and portrait slot | `src/content/about.ts` |
| ONEKNIGHT domain model and client contract | `src/features/oneknight/domain.ts`, `client.ts` |
| ONEKNIGHT demo implementation (all data fictional) | `src/features/oneknight/demo/` |
| Module catalogue | `src/data/modules.ts` |
| Karpatu.shop screenshots | `public/case/karpatu/` (regenerate with `npm run images`) |

## Rules this codebase keeps

- No invented results, testimonials, metrics or integrations. Unknown values are `null` and render an honest pending state.
- Demo data is labelled as demo in the UI.
- Every control that looks interactive does something.
- The ONEKNIGHT screens depend only on the `OneKnightClient` interface; the live API replaces `createDemoClient` in `state.tsx`.
