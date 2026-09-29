# Round 4 questionnaire: owner answers (2026-09-29)

Analytics and reports, integrations and the Telegram bot, team work, migration and edge cases, reviews/bonuses/carts/card payments. The agreed result goes into ARCHITECTURE.md.

## Block 1: analytics and reports
- F01 order attribution: first touch (where the person first came from), as now
- F02 exclude visits of the business and its team (signed-in cabinet users): yes
- F03 real-time «Зараз на сайті: N»: yes, on Home and in Analytics
- F04 monthly PDF report to the owner in Telegram on the 1st: yes
- F05 compare several sites in one report: yes
- F06 «which products bring 80% of revenue» (ABC in plain words): yes
- F07 repeat purchases chart by month: yes
- F08 managers report: owner only
- F09 delivery report (days in transit, refusal % by city and carrier): yes
- F10 «Гроші в дорозі» (COD not yet received): yes, on Home for «Фінанси»
- F11 COD reconciliation with Nova Poshta: yes, if the NP API provides the data (to verify)
- F12 site searches without results + «додайте товар» hint: yes
- F13 hide/show Home cards per person: yes
- F14 UTM link builder: yes
- F15 QR codes for offline ads (from the UTM builder): yes
- F16 freshness: orders instantly, traffic every few minutes
- F17 forecasts: revenue to month end, «товар закінчиться через ~N днів»
- F18 seasonality (same month last year) when a year of data exists: yes
- F19 plain-language explanations of changes, rule-based (no AI): yes
- F20 report export: Excel, PDF

## Block 2: integrations in detail and the Telegram bot
- F21 Nova Poshta delivery types: office, parcel locker, courier to address
- F22 NP cash on delivery: business setting, both money transfer and «Контроль оплати»
- F23 declared value: order total, editable in the form
- F24 several sender addresses: saved list with a default
- F25 NP return waybill from the order (status «Повернення»): yes
- F26 NP courier pickup: later
- F27 Ukrposhta default: Standard (as now)
- F28 status changes pushed back to Prom / Rozetka (accepted, shipped, cancelled with reason): yes
- F29 waybill number pushed to Prom / Rozetka: yes
- F30 marketplace buyer chat (Prom / Rozetka) inside ONEKNIGHT: yes
- F31 marketplace import: every 5 minutes
- F32 owner bot commands: /today, /new, search by phone or waybill
- F33 notifications to the team's Telegram group: yes
- F34 bot: shared @oneknight_bot
- F35 status notifications in Telegram: only important (new, refused, return, parcel waiting)
- F36 Instagram / Facebook Direct: later
- F37 Google Sheets: no
- F38 order number in the cargo description: yes
- F39 «Крихке»: flag on the product → set in the waybill automatically
- F40 several orders of one buyer: offer to merge before the waybill

## Block 3: team and managers
- F41 «Взяти в роботу» + auto-assignment to whoever confirms first: yes
- F42 presence «Олена зараз відкрила це замовлення»: yes
- F43 manager sees all orders or own + unassigned: per-person setting
- F44 manager commission: no
- F45 export of buyers and orders: owner only
- F46 packer sees the buyer phone masked (+380 67 *** ** 34): yes
- F47 @mentions in order comments notify the person: yes
- F48 member removed: their open orders become unassigned, owner notified
- F49 temporary access with an end date in the invite: yes
- F50 transfer of business ownership: only through support
- F51 co-owners: no (one owner + people with all permissions)
- F52 manager's own «Моє» block on Home: yes
- F53 owner sees team workload in «Команда»: yes
- F54 login only in working hours: no
- F55 product change history in the product card: yes
- F56 member work phone/Telegram visible to colleagues: yes
- F57 shift handover note: no
- F58 managers change prices/discounts in orders: no
- F59 owner alerts about deleted products / cancelled orders: in the daily summary
- F60 team invites: link only (as now)

## Block 4: migration, several businesses, pricing edge cases, beta
- F61 migration from other systems: Excel templates + direct transfers from popular systems later
- F62 «we move your data for you»: always free
- F63 beta: Karpatu + 4 friendly shops
- F64 beta testers get all modules during the 6 free months
- F65 beta feedback: «Запропонувати ідею» + a monthly call
- F66 beta ends when the owner decides
- F67 several businesses of one person: shared wallet (one balance for the person) — changes the current per-business balance
- F68 notifications from all own businesses in one bell, with the business name; click switches: yes
- F69 one trial per phone number
- F70 price changes: 30 days notice (no price lock)
- F71 yearly plan cancelled mid-year: refund unused months minus the 2 gift months
- F72 yearly plan: modules stay monthly
- F73 year ends: renewal offer 14 days before; otherwise monthly
- F74 promo code + yearly discount: no stacking, the bigger one applies
- F75 referral month granted after the invited business's first payment
- F76 transfer without a code: admin sees «нерозпізнані» and assigns manually
- F77 partial top-up during grace: stays in grace until a full month is covered (as now)
- F78 minimum top-up: 50 UAH (as now)
- F79 offer the yearly plan next to monthly when the trial ends: yes
- F80 extra discount for website clients after the 3 free months: no

## Block 5: reviews, bonuses, carts, card payments
- F81 asking for reviews without buyer messaging: QR code «Залиште відгук» on the delivery note / packing sheet
- F82 review form: on the client site (via API)
- F83 bonus for a review: no
- F84 cashback percent: set by the business
- F85 bonuses expire after 90 days
- F86 bonuses can pay up to 30% of an order
- F87 bonuses are credited after «Завершено»
- F88 buyers see their bonuses: no, only managers
- F89 cart counts as abandoned after 2 h
- F90 abandoned cart actions: «Оформити замовлення» from the cart in one click
- F91 card payment links for manual orders: no (F92 therefore not applicable)
- F93 card payment failed: order stays «не оплачено», the buyer gets a retry link, the manager a mark
- F94 card refund from the cabinet via the acquiring API: yes
- F95 acquiring fees automatically in expenses: yes
- F96 fiscal receipts only for card payments
- F97 receipt link on the «Дякуємо» page and in the order
- F98 social proof: at most every 45 s, only orders from the last 48 h
- F99 reviews on the site sorted newest first
- F100 next: more questions
