import type { Dict } from "../uk";

export const faq: Dict["faq"] = {
  eyebrow: "Questions",
  title: "FAQ",
  items: [
    {
      on: ["home", "panel"],
      q: "How much does it cost and what is included?",
      a: [
        "Website: business card from {card}, services site from {service}, shop from {shop}, corporate from {corporate}. The exact price comes in the proposal after the brief.",
        "ONEKNIGHT is {month} a month: orders, customers, products, delivery, website and team. Modules are {module} a month each, every further website {site}. With a website from us — {freeMonths} months of ONEKNIGHT free and up to {freeModules} modules.",
      ],
    },
    {
      on: ["home"],
      q: "How long does development take?",
      a: ["The exact timeline comes in the proposal after the brief: it depends on the size of the site and on how soon texts and photos are ready. Stages and the deadline show in your ONEKNIGHT account once work starts."],
    },
    {
      on: ["home", "panel"],
      q: "I already have a website. Will ONEKNIGHT fit?",
      a: ["Yes. Add the domain in the account and put the ok.js script on the site (or connect the API) — orders, carts, analytics and reviews go to the panel. Signing up yourself gives 30 days free."],
    },
    {
      on: ["home", "panel"],
      q: "I have no website. Where do I start?",
      a: ["You can start with ONEKNIGHT without a site: manual orders and orders from Prom or Rozetka (modules), customers, Nova Poshta and Ukrposhta waybills. Order a website from us when you are ready."],
    },
    {
      on: ["home", "panel"],
      q: "Where is the data stored?",
      a: ["On the ONEKNIGHT server, with daily backups. Passwords are stored only as a hash, two-step sign-in is available. The owner can download a copy of the data any time in «Business → Backups»."],
    },
    {
      on: ["home", "panel"],
      q: "How do I cancel and what happens to the data?",
      a: [
        "Just do not top up the wallet. After the grace days the account becomes «View only»: the data stays, the website keeps selling.",
        "After 90 days without payment the data may be deleted — we warn 30, 7 and 1 day before. You can download a copy any time.",
      ],
    },
    {
      on: ["home", "panel"],
      q: "How do I pay?",
      a: ["ONEKNIGHT: top up the wallet in «Billing» by bank transfer, charged once a month; a year ahead is {gift} months cheaper. Website: a prepayment by the proposal."],
    },
  ],
};

export const siteBits: Dict["siteBits"] = {
  cookies: {
    text: "This site uses only necessary cookies: sign-in, language and preferences. No ads and no third-party analytics.",
    more: "Learn more",
    ok: "Got it",
  },
  write: {
    button: "Message",
    call: "Call",
  },
  invite: {
    text: "You were invited by «{name}».",
    offer: "Create an account — after the first payment you both get a month of ONEKNIGHT.",
    cta: "Create an account",
    close: "Close",
  },
};

export const panelPage: Dict["panelPage"] = {
  meta: {
    title: "Order management and CRM for an online shop | ONEKNIGHT",
    description: "Orders from your website, Prom and Rozetka, customers, Nova Poshta and Ukrposhta waybills, products and reviews in one panel. 30 days free.",
  },
  eyebrow: "ONEKNIGHT for your business",
  title: "Orders, customers and delivery in one place",
  lead: "A panel for online shops and service businesses: orders from the website, Prom and Rozetka, a customer base, Nova Poshta and Ukrposhta waybills, products, reviews and analytics. On phone and desktop.",
  cta: "Try 30 days",
  ctaNote: "30 days free, no card needed",
  ask: "Ask in Telegram",
  day: {
    eyebrow: "A day with ONEKNIGHT",
    title: "One day of a shop",
    steps: [
      { time: "09:00", h: "Morning", p: "Home shows what to do: new orders, parcels to send, carts to call." },
      { time: "10:00", h: "Orders", p: "Confirm and create a Nova Poshta or Ukrposhta waybill: the buyer, address and product weight fill in by themselves." },
      { time: "13:00", h: "Abandoned cart", p: "A buyer left a phone and did not order — a call and an order from the same cart." },
      { time: "16:00", h: "Shipping", p: "All of today's waybills — one PDF to print." },
      { time: "19:00", h: "Content", p: "A post idea from your best sellers and reviews, the text is ready («Content plan» module)." },
      { time: "21:00", h: "Evening", p: "A new review — publish and reply. Parcels are tracked by themselves: received orders close automatically." },
    ],
  },
  compare: {
    eyebrow: "Comparison",
    title: "Spreadsheets and messengers or ONEKNIGHT",
    before: "Spreadsheets and messengers",
    after: "ONEKNIGHT",
    rows: [
      { h: "Orders", a: "In chats, a spreadsheet and a notebook", b: "One list: from the website, Prom, Rozetka and by hand" },
      { h: "Customers", a: "Search chats for who bought what", b: "A customer card: orders, total, tags, «sleeping»" },
      { h: "Delivery", a: "Waybills by hand in the carrier's account", b: "Waybills from the order, all printed in one PDF, statuses by themselves" },
      { h: "Stock", a: "Count by hand and sell what is gone", b: "Stock goes down with the order, «running out» on Home" },
      { h: "Team", a: "One password for everyone", b: "Roles and permissions, an action log, two-step sign-in" },
      { h: "Figures", a: "Unknown what sells and where buyers come from", b: "Revenue, sources, funnel, ad payback" },
    ],
  },
  price: {
    eyebrow: "Price",
    title: "{month} a month",
    points: [
      "30 days free — with everything",
      "Modules — {module} a month each, only the ones you need",
      "A year ahead — {gift} months cheaper",
      "Every further website — {site} a month",
      "Ordered a website from us — {freeMonths} months of ONEKNIGHT free and up to {freeModules} modules",
    ],
  },
  content: {
    eyebrow: "«Content plan» module",
    title: "What to post — a plan for every day",
    lead: "The plan is made from your products, sales, reviews, promotions and holidays. Here is a sample week for a made-up candle shop.",
    badge: "Sample, made-up data",
    week: [
      { day: "Mon", ch: "Instagram", t: "Best seller close up: «Lavender candle», bought 14 times in 30 days" },
      { day: "Tue", ch: "Telegram", t: "What is in the box besides the product" },
      { day: "Wed", ch: "Website", t: "Article: how to care for a candle so it burns evenly" },
      { day: "Thu", ch: "Instagram", t: "Olena's 5★ review — in the buyer's words" },
      { day: "Fri", ch: "Facebook", t: "New: «Cedar candle» — why we added it" },
      { day: "Sat", ch: "Instagram", t: "3 left: «Set of three candles»" },
      { day: "Sun", ch: "Instagram", t: "Stories poll: which scent for autumn" },
    ],
  },
  final: {
    title: "Try it on your own data",
    lead: "Signing up takes a minute, 30 days are free. Questions — in Telegram.",
  },
};
