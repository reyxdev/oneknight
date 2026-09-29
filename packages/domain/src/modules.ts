import type { ModuleDef, ModuleId } from "./index";
import { oneknightPricing } from "./pricing";

/**
 * Module catalogue. Adding a module = one entry here + copy in the web i18n.
 * `availability` drives the public demo. `live` says whether the module works in the real product:
 * a module can only be installed (and paid for) in the account once it is live.
 */
export const moduleCatalog: (ModuleDef & { live: boolean })[] = [
  { id: "novaposhta", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: true },
  { id: "ukrposhta", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: false },
  { id: "analytics", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: true },
  { id: "reviews", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: true },
  { id: "olx", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: false },
  { id: "prom", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: true },
  { id: "rozetka", price: oneknightPricing.modulePerMonth, paid: true, availability: "available", live: false },
  { id: "ai-content", price: oneknightPricing.modulePerMonth, paid: true, availability: "soon", live: false },
  { id: "zadarma", price: oneknightPricing.modulePerMonth, paid: true, availability: "soon", live: false },
];

export const moduleById = (id: ModuleId) => moduleCatalog.find((m) => m.id === id);
