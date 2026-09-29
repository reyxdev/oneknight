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
- [ ] Password reset channel: no email sending is configured. Choose email (SMTP provider) or Telegram bot; until then reset goes through support
- [ ] Google and Telegram sign-in (buttons shown as "Скоро"): need a Google OAuth client and a Telegram bot token
- [ ] Telegram alerts for new requests: create a bot in @BotFather, then set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
- [ ] Register your own account in /app and run `npm run admin:grant -w @oneknight/api -- your@email` to see all requests
- [ ] Backups and API/error monitoring: possible once client sites are hosted on an ONEKNIGHT server (decide hosting)
- [ ] Telegram: send any message to @oneknight_bot (or add it to the group) so it can write to TELEGRAM_CHAT_ID; check with `npm run notify:test -w @oneknight/api`
- [ ] First real modules (Nova Poshta, reviews, ...): each becomes installable by setting `live: true` once it works
- [ ] Investigate an intermittent React #418 (hydration) on /app in production builds: seen only after signing up through the form and reloading several times, then opening /app/. No functional impact (the account section is kept in the URL hash and React recovers), not reproducible in dev
