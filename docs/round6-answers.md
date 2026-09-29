# Round 6 questionnaire: owner answers (2026-09-29)

Section screens and lists, public site pages, and further details. The agreed result goes into ARCHITECTURE.md.

## Block 1: lists and section screens
- H01 Клієнти columns: name, phone, orders, spent, last order, tags, city, first source
- H02 quick tabs above Клієнти: Усі · Нові · Постійні · Сплячі · Топ · Ризикові
- H03 Товари columns: photo, name, SKU, price, stock, availability, category, sold in 30 days
- H04 Товари view: table + «tiles with photos» switch
- H05 Відгуки: moderation queue as cards (publish / reject / reply)
- H06 moderation keys (A publish, R reject, next): yes
- H07 business rating summary (average, count, star distribution) at the top of Відгуки: yes
- H08 Аналітика tabs: Огляд · Джерела · Воронка · Товари · Реклама · Доставка · Менеджери
- H09 one site screen tabs: Стан (monitoring, audit) · Налаштування · API й вебхуки
- H10 adding a site: 3 steps with progress (domain → ok.js code copy / send to developer → «Перевірити»)
- H11 ok.js verification: automatic on the first visit + «Перевірити зараз»
- H12 top of Оплата: subscription state, next charge date and amount, wallet + «Поповнити»
- H13 breakdown of the next charge (ONEKNIGHT, modules, sites, discounts): yes
- H14 Команда: table (role, permissions, 2FA, last login, workload) + invites below
- H15 permissions: click a person → side panel with grouped checkboxes and an explanation of each
- H16 Модулі: tabs Рекомендовані · Усі · Мої модулі; cards grid
- H17 module groups: Доставка · Маркетплейси · Продажі (reviews, bonuses, card payments) · Аналітика
- H18 Послуги: «Мої проєкти» on top (if any), then services and requests
- H19 client's project page: stages bar, current stage + «що потрібно від вас», payments, comments
- H20 «Мій профіль» tabs: Профіль · Безпека · Сповіщення · Реферали

## Block 2: public site pages
- H21 /panel headline: «Замовлення, клієнти й доставка в одному місці»
- H22 /panel order: headline + «Спробувати 30 днів» → a day with ONEKNIGHT → demo → modules → price → FAQ → call to action
- H23 «Як працює день з ONEKNIGHT»: yes, animated on scroll
- H24 website calculator inputs: site type, number of products, design from scratch / based on ready, languages, content filling
- H25 calculator prices: edited by the owner in admin (draft from the «від» prices)
- H26 «Замовити з цим розрахунком»: lead prefilled with the chosen options
- H27 FAQ: price and what's included, timeline, existing site, without a site, where data is stored, how to cancel and what happens to data, how to pay
- H28 status page: panel, site API, Telegram bot, Nova Poshta / Ukrposhta availability, 90-day incident history
- H29 status: automatic from checks + owner notes on incidents
- H30 API docs sections: getting started · site key · products · orders · reviews · pages · ok.js · webhooks · errors and limits
- H31 code examples: JavaScript, curl, PHP
- H32 API docs languages: Ukrainian + English
- H33 footer: contacts, legal, panel login, status, API docs
- H34 SEO: «розробка сайтів» on the home page + «облік замовлень / CRM для інтернет-магазину» on /panel
- H35 new cases: /cases page + the best on the home page
- H36 «Про мене»: personal (who, why, photo)
- H37 «Спробувати ONEKNIGHT» on the home page: only in the ONEKNIGHT block, leads to /panel
- H38 404: as now + links to services, /panel and login
- H39 questions on /panel: «Запитати в Telegram» button
- H40 video overview: later

## Block 3: ok.js and widgets on client sites
- H41 widget look: takes the site's font; accent colour set in the panel
- H42 social proof position: bottom left; on phones at the bottom above site buttons
- H43 social proof with product photo and link: yes
- H44 closed social proof: hidden for the rest of the visit
- H45 site banner type: top bar
- H46 banner pages: all / home only / pages by address
- H47 closed banner reappears only when it is a new banner
- H48 abandoned-cart capture: developer adds data-ok-phone and data-ok-cart attributes
- H49 reviews block: ready block through ok.js (<div data-ok-reviews>) + API for custom sites
- H50 rating stars next to products (<span data-ok-stars="id">): yes
- H51 Google rating data: API returns a ready fragment for server-side insertion + ok.js fallback
- H52 widget language: by the page language (uk / en)
- H53 live widget preview in the panel: yes
- H54 one switch to turn off all widgets of a site: yes
- H55 widgets appear after full page load; social proof not earlier than 8 s
- H56 ok.js: small core (analytics), widgets lazy-loaded only if enabled
- H57 contact clicks detected automatically from tel:, viber:, t.me links
- H58 «via ONEKNIGHT» in widgets: follows the client's choice for the «Зроблено на ONEKNIGHT» link
- H59 developer instructions generated per site (key, enabled widgets) + «надіслати розробнику»
- H60 widget health: «Сайт → Стан» shows which blocks ok.js found and where

## Block 4: API, webhooks, card payments, receipts
- H61 webhook events: order created, status changed, order paid, stock changed, product changed
- H62 site keys split: public (ok.js: read + analytics) and secret (site server)
- H63 key rotation: new key at once, the old one works 24 h more
- H64 API versions: /v1 in the path; breaking changes → new version, old one kept 6 months
- H65 up to 3 webhook URLs per site, each with its own events
- H66 «Дякуємо» page can read order and payment status by number + phone: yes
- H67 stock reserve only during card payment, 15 min
- H68 first acquiring: Monobank
- H69 payment page: the provider's hosted page, then back to «Дякуємо»
- H70 Apple Pay / Google Pay through the provider: yes
- H71 partial card refunds: yes
- H72 first ПРРО: Checkbox
- H73 card refund → refund receipt in ПРРО automatically: yes
- H74 ПРРО shift opened with the first receipt of the day, closed at night automatically
- H75 card payment covers goods only; delivery paid by the recipient at the post office
- H76 API errors: code + readable message (uk/en by the language header)
- H77 API log (7 days) in «Сайт → API й вебхуки»: yes
- H78 bulk product import/update through the API with the secret key: yes
- H79 write access for sites: orders and reviews (as now) + payment status updates
- H80 alert the owner when a site's API calls fail en masse: yes, in «Що треба зробити» and Telegram

## Block 5: how we build
- H81 small pieces the owner can click through right away
- H82 the local panel stays running at http://localhost:8080; each report says what to click
- H83 review data: a separate «Демо-магазин» business with realistic data; Karpatu is not touched
- H84 git: commit each verified piece to main (as now)
- H85 the current panel may be broken and rebuilt; keep Karpatu data and the owner's account
- H86 missing keys (Monobank, Checkbox, Prom…): build from the docs with tests on documented responses, mark «перевірити з ключем»
- H87 legal drafts: now, in parallel
- H88 public site changes: after the main panel stages, before the beta
- H89 move to the OVHcloud VPS: at the very end
- H90 beta starts after stages 1, 2, 3 and 6 (skeleton, orders, clients, ONEKNIGHT sales)
- H91 report after each piece: short Ukrainian summary + 3–5 «what to click» steps + screenshots
- H92 conflicting decisions found while building: ASK the owner
- H93 if time is short: the client's daily work first (orders, clients, waybills)
- H94 old demo on the site stays until the new one is ready
- H95 renames (Покупці → Клієнти, admin «Клієнти й сайти» → «Бізнеси") in stage 1
- H96 old browser tests are updated together with the changes
- H97 progress: status table in ARCHITECTURE.md, updated after each piece
- H98 grey zones without a decision: ASK the owner
- H99 first piece of stage 1: new menu, «Бізнес», «Мій профіль», renames, admin as a separate mode
- H100 next: more questions — about a new module (see note)

### Owner's note (new module idea)
Business profiles Facebook / Instagram / TikTok as simple on/off switches. Purpose: a 30-day content plan (calendar) for these channels and for the site, as recommendations: what to post, which video, what character, which photo, etc. A new module for 99 UAH that generates content-plan ideas from real data connected to the panel: analytics, ad campaigns, discounts, promotions, best sellers, wholesale buyers (maybe a bigger discount by setting), etc. The owner asked for 100 more questions about it.
