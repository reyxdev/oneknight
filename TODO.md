# Open items (nothing below has been invented)

Owner input needed before launch. The UI shows an honest placeholder for each.

- [ ] Ivan: full name with patronymic (About section)
- [ ] Ivan: studio portrait (professional photo, no AI)
- [ ] Karpatu.shop: owner name, photo, rating, written testimonial (with permission to publish)
- [ ] Karpatu.shop: verified metrics, if any should be shown
- [ ] Karpatu.shop: optional 30-second video testimonial
- [ ] Phone: confirm +380683587559 accepts voice calls (it was supplied as Viber / WhatsApp)
- [ ] IBAN requisites: set PAYMENT_RECIPIENT, PAYMENT_IBAN, PAYMENT_TAX_ID in .env (the account offers top-ups only then)
- [x] Production domain: oneknight.pro (`src/config.ts`)
- [ ] Legal wording for the 7 legal pages (reviewed by a specialist)
- [ ] Warranty policy wording (data model only, no terms invented)
- [ ] Backup retention policy (no guarantee is stated anywhere)
- [ ] Kronospan 5994 screen colour: tune `--alby` in `src/styles/tokens.css` against a physical sample
- [ ] Google integration scopes (only when the real product connects Google)
- [ ] Zadarma and AI content modules: future, shown as future only
- [ ] Karpatu.shop screenshots: refresh when the site changes (capture scripts in the session notes; images in `public/case/karpatu/`)
- [ ] OG image `public/og.png` is a render of the hero; replace if a designed one is preferred
- [x] Password reset: admin-created one-time link (no email). Optional later: self-service reset through the Telegram bot
- [ ] Google and Telegram sign-in (buttons shown as "Скоро"): need a Google OAuth client and a Telegram bot token
- [ ] Telegram alerts for new requests: create a bot in @BotFather, then set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
- [ ] Register your own account in /app and run `npm run admin:grant -w @oneknight/api -- your@email` to see all requests
- [x] Backups of ONEKNIGHT data: daily automatic + manual, download for the owner
- [ ] Backups of the website files themselves and API/error monitoring: possible once client sites are hosted on an ONEKNIGHT server (decide hosting). Restore from a copy in the UI (now through support)
- [ ] Telegram: send any message to @oneknight_bot (or add it to the group) so it can write to TELEGRAM_CHAT_ID; check with `npm run notify:test -w @oneknight/api`
- [x] Live modules: reviews, analytics, Nova Poshta, Prom and Rozetka (orders import). Others become installable by setting `live: true` once they work
- [ ] Nova Poshta: connect your real API key in «Інтеграції» and create one test waybill (tests use recorded-shape responses; a real key was not available)
- [ ] Prom: connect a real API token in «Інтеграції» and check one import; then decide on pushing status changes back (`orders/set_status`)
- [ ] Investigate an intermittent React #418 (hydration) on /app in production builds: seen only after signing up through the form and reloading several times, then opening /app/. No functional impact (the account section is kept in the URL hash and React recovers), not reproducible in dev
- [ ] Contests / public promotions: decide the rules (who takes part, prizes as keys or promo codes); the key and promo code system already covers the rewards
- [ ] Telegram: link your own account once (Профіль → Telegram) to receive client-style notifications; in production consider a webhook instead of long polling
- [ ] Rozetka: connect a real seller account (a separate manager user) and check one import; field mapping follows the official example
- [ ] Ukrposhta: built from the official docs; needs the contract keys to check one real shipment and label
- [ ] OLX: needs a partner app (client id/secret) from OLX before it can be built and tested honestly
- [ ] Build: «Почати підписку» in Оплата for clients without a website order (balance → 149 UAH now, active, no free months)
- [ ] Build: admin marks «Підтримка за договором» on a business; the cabinet shows it (no purchase in the cabinet)
- [ ] Owner: buy an OVHcloud VPS (VPS-1 is enough to start) when we launch; then point oneknight.pro to it
- [ ] Owner: register a ФОП (after the passport arrives) before taking money from clients; then put the ФОП details into the offer, terms and PAYMENT_* requisites
