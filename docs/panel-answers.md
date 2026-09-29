# Panel questionnaire: owner answers (2026-09-29)

Raw answers; the agreed result is written into ARCHITECTURE.md §4 when all blocks are done.

## Block 1: sales and subscription model
- Q01 main customer: small online shops (goods, delivery)
- Q02 trial for ONEKNIGHT bought without a website: 30 days
- Q03 empty account after sign-up: show sample orders marked «приклад» until the first real order
- Q04 yearly payment: 2 months free
- Q05 referral: both get a free month
- Q06 value widget («через ONEKNIGHT пройшло N замовлень на X грн»): only in Оплата
- Q07 module upsell: in context where useful
- Q08 service upsell in insights: yes
- Q09 «Зроблено на ONEKNIGHT» link on client sites: optional (client decides)
- Q10 limits in the 149 UAH subscription: none
- Q11 several sites in one business: extra charge for each additional site
- Q12 suspended: read-only cabinet, the website keeps working
- Q13 data deletion after suspension: 90 days with warnings
- Q14 deleting a business/account: only through support
- Q15 CSV/Excel export in every list: yes
- Q16 cabinet language: Ukrainian + English
- Q17 shop currency: UAH + USD/EUR
- Q18 payment reminders: 3 days before
- Q19 PDF invoice for top-ups (ФОП/ТОВ): yes
- Q20 promo banner set from admin: yes, closable

## Block 2: home and daily work
- Q21 each additional site: 149 UAH/month (the first is included)
- Q22 currencies: one currency per site; home figures in UAH at the NBU rate
- Q23 home figures: revenue, visits, conversion visit→order, % cancelled (chart shows orders)
- Q24 revenue = all orders except cancelled
- Q25 chart: revenue and orders together
- Q26 monthly revenue goal with progress and forecast: yes
- Q27 unconfirmed new order becomes urgent after 2 h
- Q28 «без ТТН» after confirmation
- Q29 low-stock threshold per product
- Q30 «Що треба зробити» items can be snoozed until tomorrow
- Q31 reward for completing «Перші кроки»: +7 free days
- Q32 money visibility: new permission «Бачить фінанси»
- Q33 new order while the cabinet is open: sound + popup
- Q34 extra home blocks: latest reviews, «Відправити сьогодні»
- Q35 insights: up to 3 most important
- Q36 business working hours: configurable
- Q37 Telegram digest: daily evening summary
- Q38 global search with «/»: yes
- Q39 quick actions on home: yes
- Q40 theme: follows the system + switch

## Block 3: orders
- Q41 numbering: own sequence per business, from 1001
- Q42 statuses: the business adds its own
- Q43 cancel reason: required, from a list
- Q44 payment tracked separately from status (unpaid / prepaid / paid / refunded)
- Q45 prepayment with cash on delivery: COD = total − prepayment
- Q46 manual discount in an order: no
- Q47 editing an order: until shipped, with change history
- Q48 «Не додзвонились»: reminder to call back in 2 h
- Q49 internal team comments in an order: yes
- Q50 responsible manager: automatically whoever first opens/confirms
- Q51 bulk actions: status, create waybills, print all labels in one PDF, Excel export
- Q52 documents: sales invoice (видаткова накладна), warranty card
- Q53 possible duplicate (same phone in 24 h): warn and offer to merge
- Q54 buyer tagged «Проблемний»: red warning + «лише передоплата» hint
- Q55 parcel refused / returning: status «Повернення»; after it arrives back, stock returns and the buyer gets «Проблемний»
- Q56 carrier tracking: every hour
- Q57 parcel waiting at the office 3+ days: «Що треба зробити» item to call the buyer
- Q58 views: list + kanban board by status
- Q59 default order: urgent first, then new
- Q60 list columns: number, date, buyer, phone, items, total, waybill + parcel state, payment, source
- Q61 manual order sources: ready list (call, Instagram, Viber, Telegram, Facebook, TikTok, in person) + custom
- Q62 item not in the catalogue in a manual order: allowed (name + price)
- Q63 stock is taken when the order is created, returned on cancel (as now)
- Q64 splitting an order into several parcels: no

## Block 4: buyers
- Q65 custom statuses each belong to a base group (New / In progress / Shipped / Done / Cancelled / Return): yes
- Q66 buyer fields besides name/phone: default delivery address/office, first source, company + EDRPOU
- Q67 buyer figures: total spent, orders count, last order
- Q68 automatic segments: new, regular, sleeping, top by sum, risky
- Q69 sleeping = no purchase for 90 days
- Q70 auto «Проблемний» after 1 refused parcel
- Q71 channels to write to buyers: «поки ніяк» (only call/Viber buttons) — conflicts with Q72-Q77, clarified in block 5 (Q87)
- Q72 SMS/Viber paid from the ONEKNIGHT balance with a markup
- Q73 auto messages: accepted, shipped + waybill, arrived at the office, pickup reminder, review request
- Q74 review request 1 day after receipt
- Q75 message texts: ready templates, editable by the business
- Q76 bulk campaigns by segment: only to buyers with consent, with unsubscribe
- Q77 abandoned cart: «Незавершені» list + reminder to the buyer
- Q78 bonuses/cashback for buyers: separate module
- Q79 shop promo codes for buyers: later
- Q80 birthday: not needed
- Q81 buyer notes: visible to the whole team with buyer access
- Q82 import buyers from Excel/CSV: yes
- Q83 phone buttons: call, Viber, Telegram, WhatsApp, copy
- Q84 manual merge of buyer records: yes
- Q85 buyer asks to erase data: anonymize (name/phone wiped, orders stay in figures)
- Q86 buyer portal on the client site: no

## Block 5: products, site, analytics, reviews
- Q87 buyer messaging channel: Viber first (cheaper), SMS as fallback if Viber is not delivered; paid from the ONEKNIGHT balance with a markup (Q72)
- Q88 product variants: no (each variant is a separate product)
- Q89 categories: tree with subcategories
- Q90 product fields: SKU, old price, cost price → profit, weight/size → into the waybill, gallery, attributes
- Q91 availability: in stock / to order (N days) / expected / none
- Q92 bulk: Excel import, Prom YML import, bulk price change by %, export
- Q93 several sites: separate catalogue per site (as now)
- Q94 several warehouses: no
- Q95 site ownership check: ok.js
- Q96 uptime check: every 5 min
- Q97 weekly site quality audit with service offers when there are problems: yes
- Q98 «Вигляд сайту» (button animations, sounds): remove
- Q99 analytics reports: sources/UTM, funnel, products views vs purchases, pages, devices, cities, ad ROI
- Q100 ad spend: entered manually
- Q101 phone/Viber/Telegram clicks counted as contacts via ok.js: yes
- Q102 detailed analytics retention: 13 months
- Q103 reviews: all go to moderation
- Q104 public business reply to a review: yes
- Q105 bad review (1-2★): normal notification
- Q106 rating data for Google rich snippets in the API: yes
- Q107 import reviews from Prom / Rozetka / Google: yes, now
- Q108 review creative image: keep
- Q109 «Де моя посилка» widget: no
- Q110 social proof popup on the site: yes, only real orders, no surnames

## Block 6: team, security, support, admin
- Q111 ready roles: manager, marketer, packer (orders + print waybills, no money)
- Q112 team activity log for the owner: yes
- Q113 owner can require 2FA for the whole team: yes
- Q114 login from a new device → Telegram alert with «Це не я»: yes
- Q115 stay signed in: 7 days
- Q116 Telegram quiet hours outside business working hours (except «сайт упав»): yes
- Q117 support: tickets with photos + «Написати в Telegram» button
- Q118 expected response time shown: up to 48 h; faster with a support contract
- Q119 contextual help «?» next to each section: yes
- Q120 «Що нового» in the bell, published from admin: yes
- Q121 «Запропонувати ідею» → admin: yes
- Q122 installable web app / push: no
- Q123 referral link: in Профіль
- Q124 trial ended without balance: 5 grace days, then read-only
- Q125 admin overview: MRR, sign-ups, trial→paid, churn, grace debts, leads funnel, module popularity
- Q126 admin opens a client cabinet: read-only, logged, visible to the client in Безпека
- Q127 churn-risk list: yes
- Q128 manual balance adjustment with a reason: yes
- Q129 broadcast to all or to a segment (trial, in debt, with module X): yes
- Q130 website leads pipeline (new → contacted → proposal → prepaid → in work → delivered / lost), notes, reminders: yes
- Q131 website projects: stages, deadline, part payments; the client sees progress and what is needed from them: yes
- Q132 admin support tools: canned replies, waiting timer, support-contract clients on top
- Q133 admin Telegram: new lead, sign-up, top-up waiting, new ticket, client site down, new idea
- Q134 admin daily morning digest: yes
- Q135 priorities: all seven, in the listed order: menu+home, orders, buyers, buyer messages, products, ONEKNIGHT sales, admin
