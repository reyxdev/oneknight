# Design questionnaire: owner answers (2026-09-29)

Raw answers about look, buttons, motion, the module path, the public site, sign-up and mobile. The agreed result goes into ARCHITECTURE.md.

## Block 1: style and feel
- D01 feel: calm work tool, clean, fast
- D02 density: balanced
- D03 accent: brand blue as on the site
- D04 order status colours: fixed colour per base group
- D05 corners: rounded, as now
- D06 font: Geologica (same as the site)
- D07 tabular figures for sums and numbers: yes
- D08 menu icons: line icons, as now
- D09 empty states: icon + explanation + first-action button
- D10 tone: formal «ви»
- D11 emoji: only in Telegram notifications
- D12 knight logo: in the menu and animated while loading
- D13 motion: smooth transitions between screens
- D14 sounds: only important (new order, error)
- D15 celebrations (first order, monthly goal): subtle card
- D16 time: relative («2 год тому»), exact on hover
- D17 money: «1 100 грн»
- D18 desktop lists: table with columns, click to sort
- D19 details: side panel, list stays visible
- D20 width: lists full width, forms narrower
- D21 collapsible menu (remembered): yes
- D22 client business logo (top of the panel and on documents), uploaded in Реквізити бізнесу: yes

## Block 2: buttons, confirmations, lists
- D23 primary button: contrast (dark on light, light on dark), as on the site
- D24 save in long forms: sticky bar at the bottom that appears when there are changes
- D25 saving: toggles/statuses instantly; forms with a button + «є незбережені зміни» warning
- D26 delete: immediately + «Скасувати» for 7 s in the toast
- D27 confirmation dialog for: bulk actions on 5+ records, cancelling an order (with reason), disabling a module, disconnecting an integration, removing a team member
- D28 toasts: bottom right
- D29 toast time: success 4 s, errors stay until closed
- D30 loading: animated knight
- D31 form errors: under the field + scroll to the first error
- D32 offline: «Немає з'єднання» bar, automatic retry, changes are not lost
- D33 shortcuts: / search, N new, Esc close, ↑↓ in lists, ? help
- D34 tooltips on icon-only buttons: yes
- D35 row actions: icons on hover + «⋯» menu
- D36 inline editing in tables (status, stock, price): yes
- D37 filters: frequent ones as chips above the list, the rest under «Фільтри»
- D38 saved views per person: yes
- D39 long lists: pages
- D40 rows per page: 50
- D41 copy buttons (order number, phone, waybill, key): yes
- D42 status changed by mistake: «Скасувати» in the toast for 7 s
- D43 table columns: can be hidden, not reordered
- D44 PDFs: open in a new tab

## Block 3: the module path
- D45 module card: one-line benefit, 3 points «що вміє», what it needs (key, contract), where it appears in the cabinet, price
- D46 module details: side panel on card click
- D47 free module test outside the trial: no
- D48 prorating mid-month: not answered (default: keep full 99 UAH as now until decided)
- D49 before buying: summary «Сьогодні спишемо X грн, далі 99 грн разом із підпискою» + «Підключити»
- D50 not enough balance: in the same dialog «Поповнити на X грн» with requisites; the module turns on when the money arrives
- D51 module needs a key: step 2 right away (the same block as in Integrations, no navigation), then «Готово, ось де це працює»
- D52 module without a key: open its section right away
- D53 module needs ok.js: check whether it is installed; if not, instructions + «Надіслати інструкцію розробнику»
- D54 newly unlocked section: «Нове» badge until opened
- D55 first open: intro card «що тут є й перший крок», closable
- D56 where modules without a menu item show they work: «Мої модулі» tab with status (works / key needed / error) + buttons and badges in orders
- D57 bought but key missing/broken: red dot on Інтеграції, «Що треба зробити» item, Telegram
- D58 usage on the module card («цього місяця: 34 ТТН»): yes
- D59 disabled module data: kept 90 days, re-enabling restores everything
- D60 disabling mid-month: works until the end of the paid month, then off
- D61 ask why when disabling (optional, one click) → admin: yes
- D62 trial end with 5 free modules: all stay and become paid (as now)
- D63 «Рекомендовано для вас» from the data: yes
- D64 bundle discount: no
- D65 modules in development: shown with «Повідомте, коли буде»; demand visible in admin
- D66 module price: «99 грн/міс · ≈3 грн на день»

## Block 4: public site oneknight.pro
- D67 hero buttons: one, «Замовити» (as now)
- D68 header: «Увійти» + «Замовити»
- D69 separate ONEKNIGHT page for people who already have a site (oneknight.pro/panel): yes
- D70 demo: short on the home page + full on the ONEKNIGHT page
- D71 «Спробувати зі своїми даними → 30 днів безкоштовно» inside the demo: yes
- D72 ONEKNIGHT prices on the site: 149 UAH/month, 30 days free
- D73 comparison: generic «таблиці й месенджери vs ONEKNIGHT», no competitor names
- D74 FAQ: on the home page and the ONEKNIGHT page
- D75 blog: later, structure prepared
- D76 client testimonials: block appears by itself when real ones exist
- D77 showcase of client sites (with consent): yes, when there are some
- D78 floating «Написати» (Telegram/Viber): only on phones
- D79 animated scroll scenes: keep
- D80 WebGL on weak phones: lighter version
- D81 order form: two steps (name, phone, site type → accepted; brief optional)
- D82 after a lead: «Що далі» + «Створіть кабінет, щоб бачити статус»
- D83 website price calculator with a «від — до» range: yes
- D84 referral visitor: banner «Вас запросив бізнес X — місяць у подарунок» + sign-up
- D85 cookies: small notice at the bottom
- D86 status page (status.oneknight.pro): yes
- D87 «Увійти» when signed in: becomes «Відкрити ONEKNIGHT» (as now)
- D88 English version: keep, full

## Block 5: sign-up and first login
- D89 sign-up fields: as now (name, phone, email, password), no business name
- D90 onboarding questions: «Сайт уже є?», «Що продаєте?», «Як доставляєте?», «Де ще продаєте?»
- D91 onboarding questions can be skipped: no, required
- D92 30-day trial (without a website from us): starts with a «Почати пробний період» button
- D93 trial counter: small counter at the top «Пробний: 23 дні» → Оплата
- D94 trial end reminders: 3 days and 1 day before
- D95 terms: text «Реєструючись, ви погоджуєтесь з умовами» with links
- D96 phone field: +380 mask
- D97 password: from 8 characters + «показати»
- D98 forgot password: self-service through the Telegram bot if Telegram was linked; otherwise through the admin
- D99 Google / Telegram sign-in buttons: hidden until they work
- D100 login screen: centred card (as now)
- D101 session expired mid-work: sign-in dialog on top, back to the same place, nothing lost
- D102 invited member's first screen: section by role (manager → Замовлення, marketer → Аналітика)
- D103 referral code at sign-up: hidden under «Є код запрошення?»
- D104 cabinet language on first login: by the site version they came from; changeable in Профіль
- D105 sample orders: disappear with the first real order + «Прибрати приклад» button
- D106 Telegram right after sign-up: separate dialog right away
- D107 2FA for new accounts: optional, item in «Перші кроки»
- D108 email already registered: «Акаунт уже є» + «Увійти» with the email filled in
- D109 «Спробувати демо без реєстрації» on the login screen: yes
- D110 another business for the same person: «+ Новий бізнес» in the business switcher, each pays separately

## Block 6: mobile, accessibility, details
- D111 orders on phones: cards with swipes (right = confirm, left = «не додзвонились») + buttons
- D112 one-tap call from the order card on phones: yes
- D113 waybill created on a phone: «Надіслати PDF у мій Telegram»
- D114 details on phones: full screen with «назад»
- D115 «+» on phones: round floating button above the bottom bar in Orders and Products
- D116 tablet: like desktop with a collapsed menu
- D117 accessibility: WCAG AA (keyboard, focus, labels, contrast)
- D118 statuses also shown with icon/text, not only colour: yes
- D119 text size setting (smaller / normal / larger): yes
- D120 time zone: always Kyiv
- D121 tab title with the new-orders counter: yes
- D122 bell grouping: not answered (default: Сьогодні / Вчора / Раніше)
- D123 «Приховати суми й телефони» switch: yes
- D124 NPS survey after 30 days, once per 3 months, results in admin: yes
- D125 score 9–10 → offer the referral link: yes
- D126 «Лист пакування на сьогодні» (items per order) print: yes
- D127 week start: not answered (default: Monday)
- D128 home comparison: the person chooses (previous period / same period last year)
- D129 new-order sound: own short ONEKNIGHT sound, can be muted
- D130 new-order popup: number, sum, items, buyer + «Відкрити» and «Підтвердити»
- D131 several orders at once: one popup «3 нові замовлення» with a list
- D132 version + «Що нового» at the bottom of the menu: yes
