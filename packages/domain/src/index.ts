/**
 * ONEKNIGHT domain model. Shared by the demo client today and the real API client later.
 * Multi-site and multi-member from day one: every business entity carries a siteId.
 */
export type ID = string;
export type Money = number; // UAH, integer

export type Role = "owner" | "manager" | "marketer" | "packer";
export type Permission = "orders" | "products" | "reviews" | "analytics" | "site" | "modules" | "billing" | "team";
export type Member = { id: ID; name: string; role: Role; permissions: Permission[] };

export type Site = { id: ID; domain: string; status: "up" | "down" | "degraded" };

export type OrderStatus = "new" | "confirmed" | "paid" | "shipped" | "done" | "cancelled";
export const orderFlow: OrderStatus[] = ["new", "confirmed", "paid", "shipped", "done"];
export type Order = {
  id: ID;
  siteId: ID;
  number: number;
  customer: string;
  phone: string;
  items: { productId: ID; qty: number; price: Money }[];
  total: Money;
  status: OrderStatus;
  delivery: "novaposhta" | "ukrposhta" | "pickup";
  payment: "cod" | "iban";
  /** Warranty is stored as data only. Terms are not invented by the system. */
  warranty: { enabled: boolean; until: string | null; note: string | null };
  createdAt: number;
  waybill: string | null;
};

export type Product = { id: ID; siteId: ID; name: string; price: Money; stock: number; photo: number };

export type ReviewStatus = "pending" | "published" | "trash";
export type Review = {
  id: ID;
  siteId: ID;
  author: string;
  rating: number;
  text: string;
  productId: ID | null;
  consent: boolean;
  hasPhoto: boolean;
  status: ReviewStatus;
  createdAt: number;
  trashedAt: number | null;
};
export type Moderation = "off" | "manual";

export type ModuleId = "novaposhta" | "ukrposhta" | "analytics" | "reviews" | "olx" | "prom" | "rozetka" | "ai-content" | "zadarma";
export type ModuleDef = { id: ModuleId; price: Money; paid: boolean; availability: "available" | "soon" };
export type InstalledModule = { id: ModuleId; installedAt: number; free: boolean };

export type Subscription = {
  plan: "oneknight";
  price: Money;
  freeUntil: number | null;
  freeModulesLimit: number;
  /** Set when the balance cannot cover the next charge. Service keeps working until graceUntil. */
  graceUntil: number | null;
  nextChargeAt: number;
};

export type IntegrationId = "google" | "meta" | "telegram" | "novaposhta" | "ukrposhta" | "prom" | "olx" | "rozetka";
export type Integration = { id: IntegrationId; status: "connected" | "not_connected" };

export type NotificationKind = "order" | "review" | "balance" | "subscription" | "module" | "backup" | "site" | "ticket";
export type Notification = { id: ID; kind: NotificationKind; key: string; vars: Record<string, string | number>; at: number; read: boolean };

export type Recommendation = { id: ID; key: "conversionDrop" | "instagramUp"; tone: "warn" | "good"; value: number; done: boolean };

export type Check = { id: "uptime" | "ssl" | "speed" | "api" | "errors"; state: "ok" | "warn" | "bad"; value: string };
export type Backup = { id: ID; at: number; size: string; auto: boolean };

export type TicketCategory = "bug" | "question" | "change" | "oneknight" | "site" | "other";
export type Ticket = { id: ID; number: number; category: TicketCategory; text: string; screenshot: boolean; status: "open" | "answered" | "closed"; at: number };

export type ButtonAnim = "none" | "lift" | "pulse" | "shine";
export type HoverFx = "none" | "glow" | "underline" | "scale";
export type ClickSound = "off" | "soft" | "glass" | "wood";
export type NoticeStyle = "toast" | "banner" | "minimal";
export type Customization = { buttonAnim: ButtonAnim; hover: HoverFx; sound: ClickSound; notice: NoticeStyle; accent: "alby" | "ink" | "forest" | "clay" };

export type Series = { day: number; visits: number; orders: number }[];
export type Source = { id: string; channel: string; campaign: string; visits: number; leads: number; sales: number };

export type OkState = {
  demo: true;
  userName: string;
  sites: Site[];
  activeSiteId: ID;
  members: Member[];
  orders: Order[];
  products: Product[];
  reviews: Review[];
  moderation: Moderation;
  modules: InstalledModule[];
  balance: Money;
  subscription: Subscription;
  integrations: Integration[];
  notifications: Notification[];
  recommendations: Recommendation[];
  checks: Check[];
  backups: Backup[];
  tickets: Ticket[];
  customization: Customization;
  analytics: { series: Series; sources: Source[] };
};

export * from "./pricing";
export * from "./modules";
