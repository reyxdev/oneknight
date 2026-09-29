# Round 3 questionnaire: owner answers (2026-09-29)

Money and law, business settings and the client-site API, admin, texts and legal, security and launch. The agreed result goes into ARCHITECTURE.md.

## Block 1: buyers' money and law
- E01 card payments on client sites: module; the client connects their own acquiring account (Monobank / LiqPay / WayForPay), a payment sets «Оплачено» automatically
- E02 fiscal receipts (ПРРО, e.g. Checkbox): integration; the client connects their own ПРРО, the receipt is created on payment
- E03 buyer pays to the client's IBAN: the buyer sees requisites + purpose «Замовлення №…» after checkout; a manager marks «Оплачено»
- E04 VAT payer: switch in requisites, VAT as a separate line
- E05 invoice and delivery-note numbers: same as the order number
- E06 delivery price (NP / Ukrposhta calculators) before creating the waybill: shown in the waybill form (delivery + COD fee)
- E07 delivery payer by default: recipient (as now)
- E08 minimum order amount: setting (can be 0)
- E09 payment methods of the client site set from the cabinet (COD, transfer, card if connected): yes
- E10 delivery methods of the client site set from the cabinet (+ office search on the site through our API): yes
- E11 refund to a buyer: record «Повернено X грн, як, коли» + payment status «кошти повернуто»
- E12 income report for ФОП (quarter, Excel): yes
- E13 business expenses (ads, packaging…) → profit on Home (for «Фінанси»): simple list by category
- E14 client leaves ONEKNIGHT with money on the balance: refunded by transfer on request, minus used (put into the terms)
- E15 currency rate: official NBU, daily
- E16 rounding: no conversion for buyers (one currency per site)
- E17 business requisites: only the owner edits
- E18 signature and stamp images on documents: can be uploaded
- E19 warranty period: set on the product, counted from the receipt date
- E20 buyer consent at checkout: text «Оформлюючи, погоджуєтесь…» + separate box for marketing

## Block 2: business settings and the client site
- E21 Google Merchant / Facebook product feeds: no
- E22 product SEO fields: filled automatically from name/description, editable
- E23 product URL slugs: the site's business, not ONEKNIGHT
- E24 product images: compressed and resized automatically (WebP, thumbnails)
- E25 «Залишилось 2 шт.» on the site: when stock ≤ the product threshold
- E26 product badges: «−X%» from the old price, «Новинка» first 14 days, «Хіт» manual
- E27 related products: automatic from order history + manual
- E28 product search API (typo-tolerant): yes
- E29 product order: drag in ONEKNIGHT + sorting on the site
- E30 optional English product texts: yes
- E31 checkout fields configured from the cabinet: yes
- E32 «Не передзвонюйте» checkbox: no
- E33 auto-confirm card-paid orders: no, always manual
- E34 webhooks for site developers (signed, retried): yes
- E35 public API documentation page: yes
- E36 test mode / test key: no
- E37 holidays calendar in working hours: yes
- E38 pickup points managed in the cabinet and shown on the site: yes
- E39 site pages (delivery and payment, returns, contacts) generated from settings via API: yes
- E40 site banner from the cabinet with show dates (through ok.js): yes

## Block 3: admin and client work
- E41 reminder if a new website lead is not contacted: 4 h within working hours
- E42 commercial proposal PDF from a lead (template, editable): yes
- E43 website contract from a template: later
- E44 website prepayment: 50%
- E45 project payments: transfer to the owner's IBAN with a payment code, confirmed like top-ups
- E46 default project stages: Бриф → Дизайн → Розробка → Наповнення → Запуск
- E47 client approves each stage in the cabinet (with a revisions counter): yes
- E48 client uploads materials via a «що потрібно від вас» checklist: yes
- E49 project communication: comments in the project + Telegram notifications
- E50 on launch automatically: 3 months ONEKNIGHT + 5 modules, site added and verified, request for a review of the owner's work (products are not copied automatically)
- E51 tags and notes on clients in admin: yes
- E52 admin tasks/reminders tied to a lead or client, reminders in Telegram: yes
- E53 server error log in admin + alerts about new ones: yes
- E54 external uptime monitor for ONEKNIGHT itself: no
- E55 admin revenue report by month: no
- E56 custom price for a specific client (with an end date): yes
- E57 seasonal pause: only through the admin
- E58 gift a module to a client from admin for N months: yes
- E59 referrals in admin + abuse protection (same phone/device): yes
- E60 anti-spam: as now (honeypot + limits, no captcha)

## Block 4: texts, legal, help
- E61 contracting party: the owner as a private person for now; a ФОП will be registered later (after the passport arrives). Legal texts keep a placeholder for the party; taking money from clients should wait until the ФОП exists (launch blocker, see TODO)
- E62 data processing agreement in the terms (client = controller, ONEKNIGHT = processor), reviewed by a lawyer: yes
- E63 list of data recipients (Nova Poshta, Ukrposhta, Telegram, OVHcloud, marketplaces) in the privacy policy: yes
- E64 terms changed: banner «Умови оновлено з …» with a link, 14 days before they apply
- E65 product name: ONEKNIGHT
- E66 module names: not answered (default: service names, «Нова пошта», «Prom»)
- E67 delivery document word: «ТТН» for both carriers
- E68 error texts: what happened + what to do, with a small code for support
- E69 first help articles: connect a site and ok.js, Nova Poshta key, first order end to end, add a manager, top up and what is charged, collecting reviews
- E70 videos in help: later, text with pictures first
- E71 support hours shown: Mon–Fri 10:00–18:00
- E72 Telegram notifications have a «Відкрити замовлення» button: yes
- E73 actions from Telegram: only «Підтвердити» and «Не додзвонились»
- E74 email from ONEKNIGHT: never, Telegram only
- E75 «Що нового»: whenever something noticeable ships
- E76 English texts: as written now, spot-checked by the owner
- E77 glossary file in the project: yes
- E78 legal texts: drafts written from our decisions, a lawyer checks before launch
- E79 legal templates for client sites (their privacy policy, returns) with «перевірте з юристом»: yes
- E80 eligibility: businesses in Ukraine, 18+

## Block 5: security, quality, launch
- E81 2FA recovery codes: no (lost phone → through the admin, as now)
- E82 passkeys: no
- E83 2FA mandatory for the admin: yes
- E84 launch: straight to a closed beta
- E85 beta size: 5 businesses
- E86 beta perk: 6 months free
- E87 anonymous cookie-free usage statistics of the panel in admin: yes
- E88 browser errors of clients sent to the admin error log (no personal data): yes
- E89 off-server database copy: OVH daily backup + weekly encrypted copy to the owner's Telegram (free, up to 50 MB)
- E90 deploys: any time
- E91 data location stated in the privacy policy (EU, OVHcloud): yes
- E92 business asks to erase everything: final erase (incl. copies) after 30 days
- E93 log retention: actions and logins 1 year, errors 90 days
- E94 API limit per client site: 120 requests/minute, more on request
- E95 undelivered webhook: retried for 24 h, delivery log in the cabinet
- E96 quality per stage: server tests + browser tests + screenshots (light/dark, phone)
- E97 cabinet screens open within 1 s
- E98 the owner reviews stages by clicking through the local cabinet himself
- E99 demo on oneknight.pro updated to the new panel: at the end
- E100 next: more questions
