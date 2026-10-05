import type { pf as uk } from "../uk/portfolio";

/** English: the same content, humour adapted (answers 115, 389, 390). Ivan checks the wording. */
export const pf: typeof uk = {
  meta: {
    title: "ONEKNIGHT — websites for small businesses",
    description: "Ivan makes a website around your business so that people call you. The price up front, payment in parts. Kuty, Western Ukraine — working with clients everywhere.",
  },
  preview: "Hidden preview: only you see the site like this. Everyone else sees the «soon» page.",
  discount: { text: "First 10 clients get 25% off a website", left: "{n} left", close: "Close" },
  nav: { works: "Work", prices: "Prices", about: "About me", faq: "Questions", contacts: "Contacts", label: "Site sections", menu: "Menu", closeMenu: "Close menu" },
  header: { calc: "Get a price", contact: "Contact", call: "Call", close: "Close", contactTitle: "How would you like to talk?" },
  hero: {
    kicker: "Websites for people who work with their hands, not with slide decks",
    h1: "I build a website around your business, so that people call you",
    sub: "I'm Ivan. I build websites for small businesses and explain everything without the marketing jargon.",
    calc: "Work out the price",
    works: "See my work",
    trust: ["Pay in parts", "Pay for each finished stage"],
    place: "Kuty, Western Ukraine · working with clients everywhere",
    phoneNote: "karpatu.shop — one of my websites",
  },
  who: {
    title: "Sound familiar?",
    calc: "Work out my price",
    items: [
      { id: "sto", title: "You run a car repair shop", text: "…and people phone for the oil change price for the tenth time today." },
      { id: "shop", title: "You sell on Instagram", text: "…and type “price in DM” until midnight." },
      { id: "master", title: "You make things by hand", text: "…things the neighbours show off, yet only your village knows about you." },
      { id: "usadba", title: "You host guests", text: "…and every one of them asks if there's a free room and how to get there." },
      { id: "salon", title: "You run a beauty salon", text: "…bookings live in a notebook and on your hand, and clients still text “any slot tomorrow?”" },
      { id: "producer", title: "You make honey, wool or woodwork", text: "…and resellers earn more on it than you do." },
      { id: "home", title: "You fix taps and sockets", text: "…and your number travels on scraps of paper." },
      { id: "cafe", title: "You cook well", text: "…and people read your menu from a blurry Instagram photo." },
    ],
    special: "Your business is unusual? Even better.",
    specialCta: "Tell me — I'll work it out",
  },
  mobileBar: { call: "Call", calc: "Get a price" },
};
