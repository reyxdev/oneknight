# Round 5 questionnaire: owner answers (2026-09-29)

Where settings live, card layouts, home and notification texts, admin screens, help and small details. The agreed result goes into ARCHITECTURE.md.

## Block 1: where settings live
- G01 business settings: new «Бізнес» item in the Налаштування group, with tabs
- G02 «Бізнес» tabs: requisites & documents, working hours & holidays, orders (statuses, cancel reasons, sources, urgency), checkout (payment, delivery, minimum, fields, pickup), buyers (tags, sleeping), goals & thresholds
- G03 site-specific settings (currency, site pages, banner, social proof, checkout fields): in «Сайт», per site
- G04 payment/delivery methods: business default, a site may override
- G05 personal vs business: separate — «Мій профіль» at the bottom of the menu next to logout, «Бізнес» in Налаштування
- G06 «Бізнес» access: owner only
- G07 settings findable through the global search «/»: yes
- G08 defaults for a new business: filled from the sign-up answers
- G09 copy settings between businesses: no
- G10 integrations: moved into «Бізнес» as a tab (no separate menu item)
- G11 billing: «Оплата» in the menu (business subscription) + the person's wallet inside it
- G12 wallet: only the owner person tops up and sees the balance; the team sees only the subscription state
- G13 document templates (delivery note, warranty card, invoice): full editor
- G14 document language: chosen when printing (Ukrainian / English)
- G15 paper: A4
- G16 notification settings: business sets defaults, each person can change
- G17 changes of important settings logged: yes
- G18 «Скинути до стандартних» per tab with confirmation: yes
- G19 monthly goal: owner sets it; ONEKNIGHT suggests one from past months
- G20 missing required settings (e.g. requisites when printing): fill-in dialog right there, then continue

## Block 2: card layouts
- G21 top of the order card: number, status, sum + actions
- G22 a single changing «next step» button: no — all actions always available (G21 is read as «status + actions»)
- G23 order card sections: all open, scroll
- G24 order history: one unified timeline (statuses, comments, waybill, edits, calls) with a filter
- G25 buyer mini-card inside the order (orders count, tags, last note): yes
- G26 parcel path with carrier statuses and dates: yes
- G27 editing in cards: click a field to edit
- G28 printing: separate buttons (not one menu)
- G29 order card keys (C confirm, T waybill, P print): yes
- G30 phones: bottom bar in the card with the main action and call: yes
- G31 product card: photos left, fields right (one column on phones)
- G32 photos: drag to reorder (first = main), drop several files, paste from clipboard, crop/rotate
- G33 product card figures (sold in 30 days, views, conversion, profit for «Фінанси»): yes
- G34 duplicate product: yes
- G35 remove from sale: «В архів» (hidden from the site, history kept); delete only without orders
- G36 «Подивитись на сайті»: product URL template in site settings, e.g. /product/{id}
- G37 categories: tree on the left in Products, drag to reorder
- G38 top of the buyer card: name, tags, total spent + contact buttons
- G39 buyer card: one unified timeline (orders, notes, reviews, calls)
- G40 buyer card actions: new order, note, merge, anonymize

## Block 3: home and notifications
- G41 «Перші кроки»: at the top above the figures until done
- G42 «Відправити сьогодні»: next to «Що треба зробити», two columns
- G43 «Що треба зробити»: 5 visible + «Показати всі»
- G44 priority: urgent orders → no waybill → parcel waiting → refusals → abandoned carts → reviews → low stock → site → ONEKNIGHT billing
- G45 packer's Home: only «Відправити сьогодні» + packing sheet + waybill printing
- G46 marketer's Home: visits, sources, conversion, reviews
- G47 goal reached: congratulation card + suggested goal for next month
- G48 daily Telegram summary time: chosen by the person
- G49 summary content: orders and revenue vs yesterday, shipped/received/refused, what to do tomorrow, team cancellations and deletions
- G50 Telegram new order: number and sum, items, city and delivery, payment, source, buyer name, buyer phone
- G51 bell click: opens the item in the side panel, marks it read
- G52 bell retention: 30 days
- G53 desktop browser notifications (Web Push, with consent) for new orders: yes
- G54 another tab active: tab title blinks «(1) Нове замовлення» + sound
- G55 site down/up alerts: owner and people with «Сайт»
- G56 site down: one alert + «знову працює»
- G57 bad review: no sound
- G58 «Не додзвонились» reminder: bell + Telegram to the responsible person
- G59 «Посилка чекає»: daily until picked up
- G60 notification text: short title + one line of details

## Block 4: admin screens
- G61 admin Overview: «what you need to do» (leads, tickets, top-ups, project deadlines) first, then platform figures
- G62 client list columns: business and owner, subscription state, balance, modules, last login, orders this month, tags, support contract
- G63 client card: tabs Огляд · Гроші · Сайти й модулі · Команда · Звернення · Нотатки · Журнал
- G64 website leads: kanban by stage + table switch
- G65 lead → «Почати проєкт»: creates the project + a client cabinet with an invite link (if none yet)
- G66 projects: kanban by stage with deadlines
- G67 deadlines: 3 days before and on the overdue day, in «Що треба зробити» and Telegram
- G68 admin search via «/» (phone, email, domain, business name, lead number): yes
- G69 broadcasts: preview + «send a test to me» + recipient count
- G70 ticket queue: support-contract clients first, then by waiting time
- G71 ideas: statuses Нова / В плані / Зроблено / Не буде; the client is notified when done
- G72 demand for modules in development: ranking by interested clients + who; they are notified at launch
- G73 NPS: score with trend + comments; low scores become «зв'язатися» tasks
- G74 errors: grouped by type with count and first/last seen
- G75 morning admin digest: new sign-ups and trials, top-ups and debts, leads and project deadlines, unanswered tickets, churn risk
- G76 admin on phones: compact (overview, leads, tickets, top-ups)
- G77 canned replies: a starter set of 10 frequent answers, editable
- G78 commercial proposal: ONEKNIGHT style, 2 pages (what we do, what's included, price, timeline, Karpatu case)
- G79 proposal sent as a link; the admin sees «переглянуто»
- G80 «Прийняти пропозицію» in the link → prepayment requisites → project starts after payment

## Block 5: sign-up answers, help, glossary, details
- G81 ONEKNIGHT usable without any website (Instagram/Viber sellers, manual orders): yes
- G82 «Що продаєте?»: Одяг і взуття · Handmade · Косметика · Електроніка · Дім і сад · Діти · Їжа · Інше
- G83 sign-up answers: enable delivery methods and suggest modules; suggest Prom/Rozetka; choose the path add site / order a site / no site; warranty card on for electronics
- G84 sign-up answers editable later in «Бізнес»: yes
- G85 help «?»: side panel + full help page
- G86 help articles edited in an admin editor by the owner: yes
- G87 «Чи допомогла стаття?» (no → «Написати в підтримку»): yes
- G88 product word for clients: «панель» («Панель ONEKNIGHT»)
- G89 people who buy from a business: «клієнти» (not «покупці») → the section «Покупці» becomes «Клієнти»; the admin's list of businesses must not also be called «Клієнти» (renamed «Бізнеси»)
- G90 wording: «Видалити» only for irreversible; «В архів», «Прибрати з команди», «Вимкнути» otherwise
- G91 kopecks only when non-zero
- G92 phones shown as +380 67 123 45 67
- G93 loader only if waiting longer than 0.3 s
- G94 feature flags per business in admin: yes
- G95 «Нове» badge on new features for 14 days or until opened: yes
- G96 dates on documents: 29.09.2026
- G97 sample orders match the sign-up category: yes
- G98 «Показати, як це працює» short animation in empty sections: yes
- G99 glossary: the owner decides disputed words himself
- G100 next: more questions
