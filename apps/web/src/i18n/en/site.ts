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
