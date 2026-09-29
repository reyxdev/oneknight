import type { WebsiteTypeId } from "./pricing";
import type { IconName } from "@/components/ui/Icon";

export type FeatureId =
  | "design" | "responsive" | "contact" | "seo" | "speed" | "services" | "booking" | "reviews" | "gallery" | "analytics"
  | "catalog" | "filters" | "cart" | "order" | "payment" | "delivery" | "about" | "blog" | "multilang" | "integrations" | "oneknight";

export const featureIcon: Record<FeatureId, IconName> = {
  design: "layers", responsive: "phone", contact: "chat", seo: "search", speed: "bolt", services: "doc", booking: "clock", reviews: "star", gallery: "image",
  analytics: "chart", catalog: "box", filters: "filter", cart: "cart", order: "check", payment: "card", delivery: "truck", about: "person", blog: "doc",
  multilang: "globe", integrations: "puzzle", oneknight: "shield",
};

/** What each website type can include. ONEKNIGHT comes with every website (see the offer section). */
export const typeFeatures: Record<WebsiteTypeId, FeatureId[]> = {
  card: ["design", "responsive", "contact", "seo", "speed", "oneknight"],
  service: ["design", "responsive", "services", "booking", "reviews", "gallery", "contact", "seo", "analytics", "oneknight"],
  shop: ["design", "responsive", "catalog", "filters", "cart", "order", "payment", "delivery", "analytics", "seo", "oneknight"],
  corporate: ["design", "responsive", "about", "services", "blog", "multilang", "contact", "integrations", "seo", "analytics", "oneknight"],
};

export const storeTabs = ["catalog", "filters", "cart", "order", "payment", "delivery", "analytics", "seo", "oneknight"] as const;
export type StoreTab = (typeof storeTabs)[number];
