import type { ModuleDef } from "@/features/oneknight/domain";
import { oneknightPricing } from "./pricing";

/** Module catalogue. Adding a module = one entry here + copy in i18n. */
export const moduleCatalog: ModuleDef[] = [
  { id: "novaposhta", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "ukrposhta", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "analytics", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "reviews", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "olx", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "prom", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "rozetka", price: oneknightPricing.modulePerMonth, paid: true, availability: "available" },
  { id: "ai-content", price: oneknightPricing.modulePerMonth, paid: true, availability: "soon" },
  { id: "zadarma", price: oneknightPricing.modulePerMonth, paid: true, availability: "soon" },
];
