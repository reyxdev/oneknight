# ONEKNIGHT: architecture plan

Status: Phase 0 plan. Source of truth for structure, tokens and boundaries. Update it when a decision changes.
Spec: the master prompt (sections referenced below as §N).

## 0. Verified facts used here

| Fact | Source |
| --- | --- |
| Kronospan 5994 = "Alby Blue", NCS S 6010-R90B, Pantone 5405 C. A muted slate blue. | kronospan.com decor page 5994 (search result) |
| Screen hex for it is not published. The hex in the palette is an approximation to be tuned against a physical sample. | no source found |
| Geologica: Cyrillic, axes `wght 100..900`, `slnt -12..0` (true oblique), also `SHRP`, `CRSV` (not used). Subset sizes with `slnt+wght`: cyrillic 25 KB + latin 37 KB. | Google Fonts metadata + css2 API |
| JetBrains Mono: Cyrillic, `wght 400..700`, cyrillic 8 KB + latin 30 KB. | same |
| Current versions: next 16.3.6, react 19.3.0, tailwindcss 4.3.3, typescript 7.0.2 (see risk R7), gsap 3.15.0, three 0.186.1. | `npm view` |
| Node 24.18, npm 11.16. No pnpm. | shell |

## 1. Stack decision (§74)

**Next.js (App Router) + React + TypeScript + Tailwind v4, static export.**

Why:
- SEO/GEO: static HTML per language, metadata API, `sitemap.ts`, `robots.ts`, JSON-LD, hreflang. Crawlers see real content, not an empty shell.
- Storytelling page needs shared client state (theme, language, modal, sound, cursor, demo session) in one React tree. Astro islands would need a cross-island store for all of it.
- Karpatu.shop is React + Node, so Ivan's stack does not change. The real ONEKNIGHT is React too; the demo UI is written to be lifted out (see §8, §11).
- Static export deploys to any CDN or nginx. No server is needed for the public site. The future ONEKNIGHT API is a separate service.
- RSC renders static text sections with zero client JS. Only interactive scenes ship JS, each behind `next/dynamic` or intersection-triggered mounting.

What is deliberately NOT used:
- three.js: the hero liquid is a 2D shader on a text mask. Raw WebGL2 fullscreen quad, no library (§66).
- GSAP / Lenis / Framer Motion: scroll scenes use one in-house primitive that writes a CSS variable (§5). No smooth-scroll hijacking, native scroll only.
- next-intl: typed dictionaries in TS are enough for two languages, zero runtime parsing.
- TanStack Query / Redux / zustand: a small `useResource` hook plus context. Revisit when the real API lands.

Dependencies at start: `next react react-dom tailwindcss @tailwindcss/postcss typescript @types/*` and `sharp` (dev, image script).

## 2. Page and section map (§55, §88)

One long page per language. Sections are chapters with shared transitions. Anchors: `#services #work #oneknight #about #contacts`.

| # | Section | Rhythm | Demonstration | Next step |
| --- | --- | --- | --- | --- |
| 1 | Hero | high energy | WebGL liquid ONEKNIGHT, cursor ripples | Замовити сайт |
| 2 | Chaos | chaotic, dark | canvas particles: social, orders, sheets collapse into one system | scroll |
| 3 | Funnel | calm, analytic | 7 clickable stages with demo numbers | scroll |
| 4 | Services | large cards | 5 live mini-demos | Дізнатися більше |
| 5 | Website types + pricing | clear | 4 types, feature reveal, store demo, calculator | Розрахувати мій сайт |
| 6 | Not a template | contrast | template vs system builds layer by layer | scroll |
| 7 | Karpatu.shop case | calm | giant title, real site preview, desktop/mobile | scroll |
| 8 | ONEKNIGHT intro | dramatic | reveal, "Ваш бізнес. В одному місці." | Відкрити демо |
| 9 | ONEKNIGHT playground | interactive | full demo dashboard | Замовити сайт |
| 10 | Modules | interactive | marketplace, install adds a module to the demo | scroll |
| 11 | Offer | strong block | 3 months free, then prices, no hidden pricing | Замовити сайт |
| 12 | Trust | quiet | real work, real client, real product | scroll |
| 13 | Process | animated timeline | 9 stages with small demos | scroll |
| 14 | Support | quiet | 1000 UAH/month, 48h target | scroll |
| 15 | About Ivan | personal | portrait, age appears here first | scroll |
| 16 | Final CTA | conversion | order modal | Замовити сайт |

Other routes: legal pages (`/legal/[doc]`, 7 docs, structured placeholders), branded 404, `/en` mirror of everything.

## 3. Component tree (§101)

```
src/
  app/
    (uk)/layout.tsx, page.tsx, legal/[doc]/page.tsx     <html lang="uk">
    en/layout.tsx, page.tsx, legal/[doc]/page.tsx       <html lang="en">
    robots.ts, sitemap.ts, not-found.tsx
  components/
    ui/           Button, Card, Modal, Tabs, Toggle, Input, Field, Badge, Tooltip, Toast
    global/       Header, Footer, Cursor, ScrollProgress, ThemeToggle, LanguageSwitcher,
                  PrefsMenu (sound, motion), Section, Providers
    motion/       Reveal, Magnetic, Counter, Sticky scene, HScene   (primitives, see §5)
  features/
    hero/         HeroScene, LiquidWord (WebGL), LiquidFallback, HeroCTA
    chaos/        ChaosScene, DataParticle, SystemTransition
    funnel/       Funnel, FunnelStage, FunnelMetrics
    services/     ServiceCard, demos/{Websites,Automation,Analytics,Advertising,Seo}Demo
    pricing/      WebsiteTypeCard, WebsiteFeatureDemo, PricingCalculator, BriefFlow
    template/     NotTemplate
    case/         CaseStudy, WebsitePreview, Testimonial, VideoTestimonial
    oneknight/    (product boundary, see §8)
    offer/ trust/ process/ support/ about/ cta/ (OrderModal, CallOption)
    legal/        LegalDocument
  content/        copy that is not translatable UI strings (structured facts)
  data/           pricing.ts, navigation.ts, funnel.demo.ts, modules.demo.ts, ...
  i18n/           uk.ts (source of truth for shape), en.ts, provider, helpers
  lib/            prefs store, sound engine, session, analytics-free helpers
  styles/         tokens.css, base.css, scenes.css
```

## 4. Design system (§61-63, §91)

All tokens live in `src/styles/tokens.css` as CSS variables and are exposed to Tailwind through `@theme`. Components never use raw hex.

### Colour (five brand colours)

| Token | Light | Role |
| --- | --- | --- |
| Ink | `#0B0E13` | text, dark sections |
| Paper | `#FFFFFF` | base surface (site is mostly white) |
| Alby | `#566F88` | brand accent, approximates Kronospan 5994 Alby Blue |
| Alby Deep | `#26364A` | dark accent, headings on tinted surfaces, pressed states |
| Alby Mist | `#DDE4EB` | tinted surfaces, borders, chart fills |

Functional tokens are derived, not new hues: success, warning, danger are muted and used only inside the ONEKNIGHT demo and forms. Neutral steps (`fog`, `line`, `muted`) are mixes of Ink and Paper.

Dark mode: Ink becomes the page, Paper becomes text, Alby lifts to `#8FA6BC` for contrast. Dark sections also exist in light mode as contrast moments (chaos, ONEKNIGHT reveal). Theme = `data-theme` on `<html>`, set by an inline script before paint to avoid flash. Default follows the OS.

Contrast is verified by a script before tokens are frozen. Alby is for accents and large text; body text is Ink or Alby Deep.

### Typography

- **Geologica** (variable `wght 100..900`, `slnt -12..0`): display, UI and body. Hero uses weight 900 at slant -12. Body uses slant 0. Real Ukrainian Cyrillic, true oblique, one file, about 62 KB for latin + cyrillic. The `SHRP` axis is not loaded: canvas text cannot set variation axes, so the hero mask and the HTML fallback would differ.
- **JetBrains Mono**: micro labels and tabular numerals in the dashboard. Loaded only with the ONEKNIGHT chunk.
- Scale (fluid, `clamp`): display 6rem to 22vw (hero only), h1 3.5-6rem, h2 2.25-4rem, h3 1.5-2rem, body 1.125rem (18px minimum for 45+ readers), small 0.9375rem. Line height 1.05 display, 1.2 headings, 1.6 body.

### Spacing, radii, shadows, borders

- Spacing: 4px base, scale 4 8 12 16 24 32 48 64 96 144. Section padding `clamp(4rem, 10vw, 9rem)`.
- Radii: 8 (controls), 16 (cards), 28 (large cards), 999 (pills).
- Borders: 1px `line`. Cards are separated by border first, shadow second.
- Shadows: `sm` (rest), `md` (hover lift), `lg` (modal). Tinted with Ink at low alpha, never pure black.
- Focus: 2px Alby Deep ring with 2px offset, always visible on keyboard focus.

### Components

- Button: primary (Ink fill, white text), secondary (outline), ghost, accent (Alby). Min height 48px. States: hover, pressed, focus, loading, disabled, success. Magnetic hover on primary CTAs only.
- Card: base, interactive (lift + border shift), dark.
- All interactive states share `--dur-*` and `--ease-*`.

### Motion tokens

| Token | Value |
| --- | --- |
| `--dur-fast` | 120ms |
| `--dur-base` | 240ms |
| `--dur-slow` | 480ms |
| `--dur-scene` | 900ms |
| `--ease-out` | `cubic-bezier(.22, 1, .36, 1)` |
| `--ease-inout` | `cubic-bezier(.65, 0, .35, 1)` |
| `--ease-spring` | `linear()` approximation, used for magnetic and modal |

### Cursor states (§8)

`default` (small dot + ring), `link` (ring grows), `view` (label VIEW), `play`, `drag`, `preview` (image thumb), `text` (thin bar), `hidden` (over inputs on request). Declared per element with `data-cursor="view"` and optional `data-cursor-label`. One delegated pointer listener, no per-element handlers. Follow uses a critically damped spring so the dot is never behind the pointer by more than a frame or two; the ring lags slightly. Disabled on `pointer: coarse`.

### Breakpoints

Mobile-first: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. Scene mode switches at `lg`: below it sticky scenes become shorter and simpler, hover becomes tap, heavy canvases lower particle counts.

## 5. Animation system (§92)

One rule: animation writes CSS variables, CSS does the rendering. React re-renders are never driven by scroll.

| Primitive | How |
| --- | --- |
| `useScrollProgress(ref)` | one shared rAF loop and one IntersectionObserver. Writes `--p` (0..1) on the element while it is near the viewport. Off-screen scenes cost nothing. |
| `Scene` (sticky) | tall wrapper + `position: sticky` stage. Children read `--p` in `calc()`/`transform`. Ranges via `--p-start/--p-end` helper. |
| `HScene` | horizontal movement inside a sticky stage, `translateX(calc(var(--p) * -N%))`. |
| `Reveal` | IntersectionObserver adds `data-in`, CSS handles fade/slide/scale. Stagger through `--i`. |
| `Magnetic` | pointer distance to element centre, spring-eased translate, one rAF. |
| `Counter` | eased number tween, tabular numerals, triggers on view. |
| `spring()` | tiny critically damped spring used by cursor, magnetic, hero pointer. |
| Canvas loop | one shared ticker; scenes register and unregister; pauses on `visibilitychange` and when off-screen. |
| Modal | CSS transition on `[data-state]`, focus trap, scroll lock, `inert` on the rest of the page. |

Hero liquid (§6): text is rasterised to an offscreen canvas (Geologica 900, skewed by `tan(12deg)` to match `slnt -12`), used as a mask texture. Fragment shader: domain-warped noise height field, analytic ripples from the last N pointer positions (uniform array, decaying), normals from height, specular + fresnel with an Alby/white/black environment gradient, bevel from blurred mask. `uDissolve` (from scroll `--p`) thresholds a noise field to dissolve the letters into the chaos scene. Fallback: CSS gradient text with `background-clip: text` (also the server-rendered state, so there is no loading screen and no layout shift). WebGL init is invisible; canvas fades in when ready. DPR capped at 2 (1.5 on mobile). Pauses off-screen.

Chaos scene (§12): 2D canvas, about 60 icon-like particles on desktop and about 28 on mobile, each with its own drift. Progress `--p` moves it through phases: calm, noisy, overloaded, then attraction to a centre where the ONEKNIGHT mark forms and particles snap into ordered rows. No paragraph, just labels on particles.

Sound (§9): Web Audio, sounds synthesised at runtime (no files, no network latency). Triggered on `pointerdown`, not `click`, so audio and visual press land together. `AudioContext` resumes on the first gesture. Off by default, one toggle in the prefs menu, persisted, volume kept low. The ONEKNIGHT customisation demo plays the selected sound as a preview because the visitor asked for it.

Motion and accessibility (§70): animations are not auto-disabled by `prefers-reduced-motion`. Instead, a visible **Motion: full / calm** control in the prefs menu (calm = no parallax, no particles motion, static hero, no autoplay loops). If the OS asks for reduced motion, a one-line unobtrusive hint offers calm mode once. Nothing autoplays longer than 5 seconds without a pause path.

## 6. Data architecture (§102-104)

| Layer | Location | Notes |
| --- | --- | --- |
| UI strings | `i18n/uk.ts`, `i18n/en.ts` | `uk` defines the shape, `en` must satisfy `typeof uk` (compile error on a missing key). Access is `dict.hero.title`, no runtime key parsing. Server components receive `dict` by param, client via context. |
| Pricing | `data/pricing.ts` | single source: 7000, 12000, 14000, 15000 UAH+, ONEKNIGHT 149/month, module 99/month, support 1000/month, 3 free months, 5 free modules, response target 48h, grace 3-7 days (configurable). Numbers never repeated in copy; copy uses placeholders filled from here. |
| Navigation | `data/navigation.ts` | items, targets, auth-dependent CTA. |
| Contacts | `data/contacts.ts` | only the three supplied channels. |
| Demo data | `data/*.demo.ts` | every file exports `{ isDemo: true }`. UI labels demo data wherever numbers appear. |
| Verified facts | `content/karpatu.ts` | fields are `null` until verified. UI renders an honest placeholder state for null. |
| Config | `config.ts` | feature flags (sound default, placeholders visible, grace days). |

Nothing invented (§77): testimonial, owner name, rating, photo, metrics, Ivan's patronymic and portrait are `null` or placeholder until provided. `TODO.md` lists each one.

## 7. Public site architecture

- Routes: `/` (uk), `/en`, `/legal/[doc]`, `/en/legal/[doc]`, 404. Each language route has its own root layout so `<html lang>` is correct in static HTML.
- Each language links the other with `hreflang` + `x-default`, self canonical.
- Server components by default. `"use client"` only for scenes, cursor, modal, prefs.
- Heavy features (hero WebGL, chaos canvas, playground, calculator) mount when near the viewport and are code-split with `next/dynamic`.
- Fonts via `next/font` (self-hosted, `display: swap`, subsets latin + cyrillic only).
- Order flow (§53) with no backend in phase 1: modal offers (a) ONEKNIGHT demo account + brief, which ends in a real hand-off (prefilled Telegram / WhatsApp / Viber message, text also copied), never a fake "sent" state; (b) call. See conflict C4.

## 8. ONEKNIGHT demo architecture (§21-52, §75, §100)

The demo is the real product's frontend running on a demo data source. The seam:

```
features/oneknight/
  domain/        types: Business, Site, Order, Review, Module, Balance, Notification,
                 Ticket, Integration, Member, Role, Permission, AccessKey (no UI)
  client/        OneKnightClient interface (auth, sites, orders, reviews, modules, balance,
                 notifications, tickets, integrations, analytics) + subscribe(event)
  demo/          demoClient implements the interface with in-memory state + timers; all data flagged demo
  state/         useResource(), ClientProvider (swap demoClient for apiClient)
  ui/            Shell (sidebar, bottom nav on mobile), screens, widgets
  screens/       Home, Orders, Site (+ live customisation), Analytics, Products, Reviews,
                 Modules, Integrations, Support, Notifications, Account (balance, IBAN), Settings
```

Rules:
- Screens depend on `OneKnightClient`, never on demo files. Replacing demo data with the API is one provider swap.
- Multi-site and roles exist in the domain types from day one (`siteId` on every entity, `Permission` checks in the shell), even though the demo shows one owner.
- Recommendations follow problem, explanation, action (§24) and open inline, they do not navigate away.
- Order states: Нове, Підтверджене, Оплачено, Відправлено, Завершено, Скасовано, plus a `warranty` record kept as data only (no invented terms).
- Reviews: moderation off / manual, approve publishes, reject goes to trash with a 30-day purge date, permanent delete.
- Modules: install deducts from balance, or is free inside the 3-month window (up to 5). Installed module appears in the sidebar. Grace period (3-7 days, configurable) shown as a warning state, not a lockout.
- Balance top-up shows IBAN instructions with placeholder requisites (`TODO`, §105). No payment provider.
- Integrations: all "Not connected" by default. Connect opens the 5-step instructions. The demo never returns fake external API data; verify ends in an honest "demo" state.
- Live customisation (§26): settings (button animation, hover effect, button sound, notification style) change a mini site preview instantly through CSS variables and the sound engine. Supported options only, no visual editor.
- Mobile (§86) is a separate shell: bottom navigation, priority cards ("what do I need to know now"), swipeable charts, big touch targets. Not the desktop dashboard stacked.

## 9. Responsive strategy (§85)

- Sticky scenes: desktop 200-400vh; below `lg` 120-220vh, simpler choreography.
- Hover replaced by tap/press feedback (scale + ripple), no cursor, no magnetic.
- Canvas particle counts and DPR reduced on mobile; hero shader falls back to CSS if the frame budget is missed for 60 frames.
- Tap targets 48px minimum. Body text never below 16px.
- Pricing and funnel become vertical stacks with the detail panel as a bottom sheet.

## 10. SEO and performance (§68, §69, §98)

SEO: semantic landmarks, one `h1`, ordered `h2/h3`, unique title/description per language, Open Graph and Twitter cards, canonical, hreflang, `sitemap.xml`, `robots.txt`, JSON-LD (`WebSite`, `Organization`/`ProfessionalService` with only supplied contacts, `Person` for Ivan, `Offer` with the public "from" prices), no filler SEO paragraphs. GEO/AI-search readiness: clear entity facts in structured data, real text for every claim, `llms.txt` optional (does not affect Google).

Performance budget (initial page, mobile 4G):
- Initial JS: target under 130 KB gzip (framework + header + hero fallback). Everything else deferred.
- LCP: the hero text is server-rendered HTML with the CSS fallback, so LCP does not wait for WebGL.
- CLS: fixed aspect boxes for every scene and preview.
- INP: pointer work runs in rAF, no layout reads in handlers.
- Images: pre-optimised WebP/AVIF by `scripts/optimize-images.mjs` (static export has no image optimiser), `loading="lazy"`, explicit sizes.
- Verification: Lighthouse and DevTools throttling on 4G + 4x CPU, real Chromium screenshots at 375, 768 and 1440.

## 11. Future real-product architecture (§76, §87)

Conceptual, not built in phase 1.

- Services: Node (TypeScript), Postgres, Redis (rate limiting, sessions, queues), object storage for uploads and backups.
- Auth: password (argon2id), Google and Telegram login, TOTP 2FA (Google Authenticator), no email verification (per spec), no SMS 2FA. Sessions with device/IP history, audit log, rate limiting, RBAC.
- Model: `users`, `organizations`, `memberships(role)`, `websites`, `subscriptions`, `modules`, `module_installs`, `balances`, `ledger_entries`, `payments(iban_transfer)`, `orders`, `order_events`, `reviews`, `integrations(encrypted credentials)`, `analytics_events`, `notifications`, `monitor_checks`, `backups`, `tickets`, `roles`, `permissions`, `promotions`, `contests`, `discounts`, `promo_codes`, `access_keys(scope: platform|module)`.
- Realtime notifications over SSE or WebSocket. The demo client already models this as `subscribe()`.
- Monitoring (availability, SSL, speed) and backups (history, restore) are jobs with recorded results; the UI never claims a check that has no job behind it.
- Admin app for Ivan: clients, sites, payments, subscriptions, modules, tickets, errors, backups, usage, leads, promotions, contests, discounts, promo codes, access keys.
- Repo evolution: today a single app. When the API starts, split into a monorepo (`apps/site`, `apps/app`, `apps/api`, `packages/domain`, `packages/ui`), moving `features/oneknight` into `apps/app` with the `OneKnightClient` interface as the shared contract.

## 12. Conflicts, risks, and how they are resolved (§106 step 3)

| # | Issue | Resolution (conservative) |
| --- | --- | --- |
| C1 | Nav lists ONEKNIGHT twice (brand and product), and §7 forbids duplicate branding visually. | Logo is the knight monogram only (accessible name "ONEKNIGHT"). The product nav item reads "ONEKNIGHT" and scrolls to the product section. |
| C2 | "Don't disable animations for reduced motion" vs accessibility. | No automatic disabling. Visible Motion full/calm control plus a one-time hint if the OS requests reduced motion. |
| C3 | Sound must be instant, browsers block audio before a gesture. | Synthesised Web Audio on `pointerdown`, unlocked on first gesture. Default off (`config.sound.defaultEnabled`), one visible toggle. |
| C4 | Order flow asks for register, brief, submit, but there is no backend in phase 1. | UI is built against an `AuthClient`/`OrderClient` interface. Demo account is stored only in the visitor's own browser and labelled so; password is never stored. The brief ends in a real hand-off (prefilled Telegram/WhatsApp/Viber message plus copy). Google/Telegram login buttons are shown disabled ("скоро"). No fake success. |
| C5 | Karpatu case needs owner name, photo, rating, testimonial, metrics. None supplied. | Fields are `null`; UI shows an honest "awaiting client approval" state. Real preview via live iframe if the site permits framing, otherwise screenshots captured from the real site. No metrics shown until provided. |
| C6 | Ivan's full name/patronymic and studio portrait not supplied. | Designed placeholder frame and name slot, in `TODO.md`. No generated face. |
| C7 | Kronospan 5994 has no published screen hex. | Approximation from NCS/Pantone reference, isolated in one token so it can be retuned. |
| C8 | "Five-colour" system vs status colours needed in the dashboard. | Five brand colours. Status colours are derived muted functional tokens used only in demo/forms. |
| C9 | "Dashboard is real" vs "no fake API". | Demo client is an honest implementation of the same interface, every dataset flagged demo and labelled in the UI. Integrations never return external data. |
| C10 | IBAN payment requisites are not supplied. | Placeholder fields marked TODO, configurable. No PSP. |
| C11 | Legal text must not be fabricated. | Seven legal pages with structured headings and "text pending legal review" blocks. |
| C12 | Hardware services must not dominate. | One small secondary block in the About/Support area, not in nav or hero. |
| R1 | Hero shader is the heaviest item. | Analytic ripples instead of ping-pong sim, DPR cap, pause off-screen, frame-budget fallback to CSS. |
| R2 | Static export has no image optimiser. | Build-time sharp script. |
| R3 | Many canvases at once. | One shared ticker, only near-viewport scenes render. |
| R4 | Cyrillic italic via `slnt` on canvas. | Canvas skew equals `tan(12deg)` to match the font's oblique. Checked visually against the HTML fallback. |
| R5 | Multiple root layouts and the 404 page. | To be confirmed against the Next version's docs during scaffold; fallback is a `[lang]` segment. |
| R6 | Two languages of long copy quality. | Ukrainian written first as source; English translated by hand, not templated. Copy reviewed against the §89 banned-phrase list. |
| R7 | TypeScript 7 may not be supported by Next's typecheck. | Pin the latest 5.x unless 7 is verified working. |

## 13. Phases

Status (2026-09-29): phases 0-6 implemented. Remaining work is owner input listed in TODO.md, plus a real backend (section 11).


0. Scaffold, tokens, fonts, i18n, data, primitives, header/footer/prefs/cursor/progress, build + screenshot check.
1. Hero (liquid), nav, order modal + demo auth + brief hand-off.
2. Chaos scene, funnel.
3. Services demos, website types, pricing, calculator, not-a-template.
4. Karpatu case, trust.
5. ONEKNIGHT intro, playground (all screens, mobile shell), modules, offer.
6. Process, support, about, final CTA, contacts, legal, 404, SEO, sound polish, QA pass (§98, §99, §108).

Each phase ends with a production build, real-browser check at 375/768/1440, and a note of what is demo, placeholder or TODO.

## 14. Implementation notes (as built)

- Karpatu.shop forbids framing (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`), so the case uses real screenshots of the live site (consent banner declined before capture), served as AVIF/WebP. Every technical claim in the case was checked against the live site's headers, HTML, robots.txt, llms.txt and sitemap on 2026-09-29.
- Order flow ends in a prefilled Telegram/WhatsApp message (Viber: copy + open), because there is no backend yet. Nothing claims to be "sent".
- Demo account: name, phone and email are kept in the visitor's localStorage only; the password is never stored.
- ONEKNIGHT demo: one shared client per page, so installing a module in the marketplace section shows up in the playground. Simulated events (new order, new review) run only while the playground is on screen.
- Integrations in the demo never fake a connection; the check returns an explicit demo message.
- IBAN requisites are not shown until provided.
- Measured on a throttled mobile profile (4x CPU, about 1.6 Mbit/s): FCP = LCP about 2.3 s, CLS 0, initial JS about 175 KB gzip (framework about 115 KB).
- The in-app preview browser reports a React hydration warning (#418) on every page, including a bare html/body test page; headless Chromium reports none. Treated as an artefact of that browser.

## 15. Real product: decisions (2026-09-29)

- Domain: oneknight.pro. Code: private GitHub `reyxdev/oneknight`. Hosting: local development first, server chosen later.
- Monorepo with npm workspaces: `apps/web`, `apps/api`, `packages/domain`.
- Proposed URL layout: site `oneknight.pro`, panel `oneknight.pro/app`, API `oneknight.pro/api` behind one reverse proxy. Same origin means session cookies stay `HttpOnly; Secure; SameSite=Lax` with no CORS. (Replaces the earlier app./api. subdomain idea.)
- First vertical slice: accounts (register without email verification, login, sessions, login history, rate limiting, TOTP 2FA) and brief/lead storage with an admin list and Telegram alert.

## 16. Guided scrolling (landing)

`apps/web/src/lib/motion/guided-scroll.ts`. Guidance exists only inside scroll-driven scenes; the rest of the page scrolls natively.

- Each sticky scene lists its meaningful keyframes: `data-stops` (hero 0; chaos 0.12, 0.32, 0.52, 0.9; not-a-template 7 frames; case intro 0.6; ONEKNIGHT intro 0.1, 0.4, 0.72; process 0.08 to 1). The last keyframe is the finished state, never a transition or blank frame.
- Inside a scene one wheel gesture, PageDown, Space or an arrow key plays to the next keyframe. The next gesture after the last keyframe glides through the transition to the next block (or to the next scene's first keyframe). Scrolling up mirrors this.
- Entering a scene from above within 0.6 screen snaps to its first keyframe. Anchor links land on a scene's first keyframe.
- One trackpad swipe = one move (inertia tails are ignored); one wheel notch = one move.
- Native: all normal sections, touch, Ctrl+wheel, horizontal wheel, open modal or menu, calm motion mode, anything with its own scroll.

## 17. ONEKNIGHT account (/app), first real slice

- `/app` and `/en/app`: separate root layout (no marketing header, cursor or guided scroll), `noindex`.
- States: loading, offline (API unreachable, with retry), login/register, TOTP step, account.
- Account sections backed by real data only: Home (honest empty states), Security (2FA with QR, sessions with revoke, sign-in history), Profile. Other ONEKNIGHT sections appear as their data exists; the full picture stays in the public demo.
- Landing: "Увійти" and "Замовити через ONEKNIGHT" lead to `/app`; a non-secret `ok_auth=1` cookie tells static pages to show "Відкрити ONEKNIGHT". The old browser-only demo account was removed.

## 18. Requests (leads)

- Table `leads` (numbered from 1001), `POST /api/leads` from the public brief (needs name and phone) or from the account (uses the account contact), `GET /api/leads/mine`, admin `GET /api/admin/leads` and `PATCH /api/admin/leads/:id` (status new / in_progress / won / lost).
- Abuse control: per-route rate limit, max 5 anonymous requests per IP per hour, honeypot field.
- The modal sends the brief to ONEKNIGHT; if the server is unreachable it offers the messenger hand-off, so a request is never lost.
- Telegram alert to the owner when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set; silently off otherwise.
- Admin role: `users.is_admin`, granted with `npm run admin:grant -w @oneknight/api -- email`.

## 19. Client sites, monitoring, notifications

- Tables `sites` (per organization, unique domain, status building / live / paused), `monitor_checks`, `notifications`.
- Monitor (in-process, every `MONITOR_INTERVAL_MIN`, default 5): HTTPS GET of the home page (up = 2xx/3xx within 10 s), response time, TLS certificate expiry. Checks older than 90 days are deleted. Only public hostnames are accepted (no IPs, no local names), so the monitor cannot be pointed at private networks.
- Up/down transitions and SSL expiring within 14 days create in-account notifications and, when configured, a Telegram line to the owner.
- Account: "Сайт" screen (status, 30-day availability, 24-hour average response, SSL days, response chart, what is checked), home summary, notification bell (polls every 30 s).
- Admin: "Клієнти й сайти": organizations with owner contacts, add site, check now, pause/resume, delete.
- Not claimed anywhere: backups (need access to the hosting), API and error monitoring. They arrive when sites run on ONEKNIGHT hosting.

## 20. Billing: subscription, balance, modules

- Prices and the module catalogue live in `@oneknight/domain` (one source for site, account and API).
- Tables: `subscriptions` (trial / active / grace / suspended / cancelled, period end, grace end), `ledger_entries` (amounts in kopecks; balance = sum), `module_installs` (free flag inside the trial), `topups` (IBAN transfers with a unique reference, pending / confirmed / cancelled).
- Trial: the admin opens 3 free months for a website customer ("Відкрити 3 місяці безкоштовно"). Up to 5 paid modules are free inside the trial.
- Renewal (hourly job, row-locked, idempotent): charge ONEKNIGHT 149 + 99 per installed module from the balance. If the balance is short: grace for GRACE_DAYS (3-7, default 5) with a notification, then suspended. A confirmed top-up renews a grace or suspended subscription immediately.
- Top-up: the client picks an amount and gets the requisites plus a reference `OK-XXXXXXXX` for the payment purpose. The balance changes only when the admin confirms the money arrived (no payment provider, per the brief). Requisites come from `PAYMENT_RECIPIENT`, `PAYMENT_IBAN`, `PAYMENT_TAX_ID`; while they are empty the account says so and offers no top-up.
- Modules can be connected in the real account only when `live: true`. Today none is live, so the store shows them as "У розробці" and nothing can be bought that does not work.

## 21. Support tickets and file uploads

- `files` table + disk storage in `UPLOAD_DIR` (random names). Uploads are JSON base64 (keeps the JSON-only CSRF guard), max 4 MB, accepted only as real PNG/JPEG/WebP by magic bytes. `GET /api/files/:id` serves public files to anyone and private files only to members of the owning organization or admins. A daily sweep removes files no row points to.
- Tickets (numbered from 201): category, status open / answered / closed, message thread with optional screenshot. Client: `/api/tickets`; admin: `/api/admin/tickets` (reply sets "answered" and notifies the client; a client message reopens). New tickets and client messages go to the owner's Telegram.
- Test accounts (`@test.oneknight.local`) and `NODE_ENV=test` never send Telegram messages.

## 22. Shop: products, orders, public site API

- `sites.public_key` (`sk_` + 32 hex, rotatable) identifies a client website for `/api/public/*` (see `docs/public-api.md`). CORS allows only the site's own domain; the cookie CSRF guard does not apply there (no cookies).
- `products` per site (price in kopecks, stock or null = made to order, public photo, active, sort). `orders` store an items snapshot with prices from the database, delivery, payment, comment, warranty as data only, waybill; `order_events` keep the status history.
- Placing an order locks product rows, checks and reserves stock, creates the order and an in-account notification. Cancelling returns stock; reopening a cancelled order takes it again (or fails if stock is gone).
- Account: «Замовлення» (filters, detail, next status, any status, waybill, warranty, history), «Товари» (photo, price, stock, visibility), site key with an example on «Сайт».

## 23. Reviews module (first live module)

- `reviews` table, `sites.review_moderation` (off / manual). Module gate: `hasModule(org, "reviews")` = installed and subscription trial / active / grace.
- Public submit with consent, rating, optional photo (private until published), https video link, product, verified purchase by order number + phone. Moderation: approve (needs consent) publishes, reject moves to trash, trash is purged after 30 days (daily job), permanent delete removes the photo too.
- Account «Відгуки»: moderation switch, tabs, actions, and a 1080×1080 PNG creative drawn in the browser (canvas) from a published review.
- Not built yet: automatic review requests after a purchase (needs an email/SMS/Telegram channel to the customer).

## 24. Analytics module

- `analytics_events` (pageview / lead / order, per-tab random session, first-touch source, channel, value). No cookies, no IP, DNT respected, bot user agents dropped, 400-day retention.
- Channel mapping (`channelOf`): utm_source aliases and referrer hosts to Instagram, Facebook, Google, Telegram, TikTok, YouTube, Viber, email, other search, direct, or `other:<host>`.
- Tracking script `apps/web/public/ok.js` (about 2.5 KB) served from oneknight.pro. Orders from the public API carry `analytics` and become "order" events with revenue.
- Account «Аналітика»: visitors, requests, sales, revenue, conversion, chart, sources in plain language with correct Ukrainian plurals, raw UTM toggle, install instructions.

## 25. Account home: real dashboard and insights

- `GET /api/dashboard`: orders today (Kyiv date), waiting new orders, 30-day sales, latest orders, 30-day visitors and daily series (with the analytics module), sites with monitoring, and insights.
- Insights (`insightsFor`) are rules over the organization's own data only: site down, SSL expiring, billing grace/suspension, new orders waiting over a day, low / no stock, pending reviews, week-over-week conversion change (only with at least 50 visits in both weeks), a channel growing 30%+ (at least 10 visits before). With no data there are no insights. "Зроблено" hides an insight for 7 days (`insight_dismissals`).
- The current account section is kept in the URL hash (`/app/#orders`): refresh, back/forward and direct links work; logout clears it.
- Lists guard against out-of-order responses (`latestOnly`).

## 26. Team, roles, permissions, several businesses

- Permissions: orders, products, reviews, analytics, site, modules, billing, team, support. The owner always has all; managers and marketers have what the owner ticks (role defaults are only suggestions).
- `orgScope(req, perm)` returns `[active organization]` only when the member has the permission, otherwise `[]`; every tenant query filters by it, so a missing permission means "sees nothing". `sessions.active_org_id` + `POST /api/auth/org` switch the business; `/api/auth/me` returns the active organization, role and permissions.
- Invitations: `POST /api/team/invites` returns a one-time link token (only its SHA-256 is stored, 7 days); `POST /api/team/accept` joins and switches to the business. Owner cannot be changed or removed; removing a member resets their sessions that were in that business.
- Account: «Команда» (permission matrix with optimistic toggles, invite link, pending invites), business switcher in the header, navigation shows only permitted sections, invitation links work before and after sign-in.

## 27. Website appearance (live customisation)

- `sites.appearance` (button animation, hover effect, click sound, notice style, accent colour) edited in «Сайт → Вигляд сайту» with a live preview and saved with the "site" permission.
- `GET /api/public/appearance`; ok.js with `data-appearance` applies it to `[data-ok-button]` elements (CSS injected once, WebAudio click sounds on pointerdown) and exposes `oneknight.notify(text)`. Supported options only; not a visual editor.
