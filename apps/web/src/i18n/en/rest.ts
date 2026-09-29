import type { Dict } from "../uk";

export const offer: Dict["offer"] = {
  eyebrow: "Offer",
  title: "Order a website and get more.",
  a: "3 months of ONEKNIGHT",
  b: "up to {n} paid modules",
  zero: "UAH 0",
  afterTitle: "After {m} months",
  rows: { ok: "ONEKNIGHT", module: "Module", support: "Technical support" },
  optional: "optional",
  calcTitle: "Work out your month after the trial",
  modules: "Modules",
  withSupport: "With technical support",
  total: "Per month",
  honest: "Every price is right here. Nothing hidden.",
};

export const trust: Dict["trust"] = {
  eyebrow: "Trust",
  title: "No need to take my word for it.",
  items: [
    { k: "work", t: "Real work", d: "Karpatu.shop: a live store you can open right now.", cta: "See the case", href: "#work" },
    { k: "client", t: "Real client", d: "The owner of Karpatu.shop. Their review appears here once they agree to publish it.", cta: "To the case", href: "#work" },
    { k: "product", t: "Real product", d: "ONEKNIGHT: the demo you already tried above.", cta: "Open the demo", href: "#playground" },
  ],
};

export const process: Dict["process"] = {
  eyebrow: "Process",
  title: "How we work",
  lead: "From request to support. You always know which stage we are at.",
  steps: [
    { t: "Request", d: "You leave a request or call." },
    { t: "Discussion", d: "We figure out what you sell, to whom and how." },
    { t: "Structure", d: "We map the site and the customer's path." },
    { t: "Design", d: "Designed for your brand, phone first." },
    { t: "Development", d: "We write code. No site builders or templates." },
    { t: "Testing", d: "Phones, speed and forms get checked." },
    { t: "Launch", d: "Domain, analytics, search. The site is live." },
    { t: "ONEKNIGHT", d: "We connect the system and show you how to use it." },
    { t: "Support", d: "We do not disappear after launch." },
  ],
  hint: "Scroll to walk through every stage",
};

export const supportPlan: Dict["supportPlan"] = {
  eyebrow: "After launch",
  title: "The site is live. We are not going anywhere.",
  price: "{price}/mo",
  plan: "Technical support",
  includes: ["Bug fixes", "Consultations", "Help with ONEKNIGHT", "Technical problems", "Small changes to the site", "Website monitoring", "Backups"],
  response: "We reply within {h} hours.",
  separate: "Separate from the ONEKNIGHT subscription. Add it any time.",
  cta: "Discuss support",
  hardwareTitle: "I also help with hardware",
  hardware: ["PC assembly and upgrades", "Windows and Linux", "Diagnostics, repair, cleaning, thermal paste", "Installing components", "Phone and tablet optimisation", "Data transfer"],
};

export const about: Dict["about"] = {
  eyebrow: "About me",
  first: "Ivan",
  age: "22",
  ageLabel: "years old",
  text: "I build websites, automate business processes and help businesses get more customers from the internet.",
  skills: ["Websites", "Automation", "Analytics", "Advertising", "SEO / GEO / AI"],
  photoPending: "Photo coming soon",
  write: "Message on Telegram",
};

export const final: Dict["final"] = {
  title: "Your business already works. The only question is how well it works online.",
  cta: "Order a website",
  how: "How would you like to start?",
};
