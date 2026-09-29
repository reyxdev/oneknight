import type { ActionResult, OneKnightClient } from "../client";
import type { ID, OkState, Order, Review } from "../domain";
import { moduleCatalog } from "@/data/modules";
import { config } from "@/config";
import { seed } from "./seed";

const DAY = 86_400_000;
let uid = 100;
const nextId = (p: string) => `${p}${++uid}`;

/** In-memory ONEKNIGHT. Every value is demo data; nothing leaves the browser. */
export function createDemoClient(lang: "uk" | "en"): OneKnightClient {
  let state: OkState = seed(Date.now(), lang);
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(e: { kind: string; id: ID }) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickN = 0;

  const set = (fn: (s: OkState) => OkState) => {
    state = fn(state);
    listeners.forEach((l) => l());
  };
  const notify = (kind: OkState["notifications"][number]["kind"], key: string, vars: Record<string, string | number> = {}) => {
    const n = { id: nextId("n"), kind, key, vars, at: Date.now(), read: false };
    set((s) => ({ ...s, notifications: [n, ...s.notifications].slice(0, 30) }));
    eventListeners.forEach((l) => l({ kind, id: n.id }));
  };

  const freeActive = () => !!state.subscription.freeUntil && state.subscription.freeUntil > Date.now();
  const freeUsed = () => state.modules.filter((m) => m.free).length;

  const simulate = () => {
    tickN++;
    const names = lang === "uk" ? ["Софія Р.", "Максим Д.", "Юлія Т.", "Олег Ф."] : ["Sofiia R.", "Maksym D.", "Yuliia T.", "Oleh F."];
    const name = names[tickN % names.length]!;
    if (tickN % 2 === 1) {
      const p = state.products[tickN % state.products.length]!;
      const number = Math.max(...state.orders.map((o) => o.number)) + 1;
      const o: Order = {
        id: nextId("o"), siteId: state.activeSiteId, number, customer: name, phone: "+380 •• ••• •• " + String(number).slice(-2),
        items: [{ productId: p.id, qty: 1, price: p.price }], total: p.price, status: "new", delivery: "novaposhta", payment: "cod",
        warranty: { enabled: false, until: null, note: null }, createdAt: Date.now(), waybill: null,
      };
      set((s) => ({ ...s, orders: [o, ...s.orders] }));
      notify("order", "order", { n: number });
    } else {
      const texts = lang === "uk"
        ? ["Дуже задоволена, замовлю ще на подарунок.", "Якість чудова, дякую!", "Все прийшло ціле, рекомендую."]
        : ["Very happy, I will order another as a gift.", "Great quality, thank you!", "Arrived intact, recommended."];
      const r: Review = {
        id: nextId("r"), siteId: state.activeSiteId, author: name, rating: 5, text: texts[tickN % texts.length]!, productId: state.products[0]!.id,
        consent: true, hasPhoto: false, status: state.moderation === "off" ? "published" : "pending", createdAt: Date.now(), trashedAt: null,
      };
      set((s) => ({ ...s, reviews: [r, ...s.reviews] }));
      notify("review", "review", { name });
    }
  };

  const client: OneKnightClient = {
    mode: "demo",
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onEvent(l) {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
    setActiveSite: (id) => set((s) => ({ ...s, activeSiteId: id })),
    setOrderStatus(id, status) {
      set((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, status } : o)) }));
      return { ok: true };
    },
    createWaybill(id): ActionResult {
      if (!state.modules.some((m) => m.id === "novaposhta")) return { ok: false, reason: "requires_module" };
      set((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, waybill: `DEMO-${o.number}` } : o)) }));
      return { ok: true };
    },
    adjustStock: (id, d) => set((s) => ({ ...s, products: s.products.map((p) => (p.id === id ? { ...p, stock: Math.max(0, p.stock + d) } : p)) })),
    addProduct(name, price) {
      if (!name.trim() || !(price > 0)) return { ok: false, reason: "invalid" };
      set((s) => ({ ...s, products: [{ id: nextId("p"), siteId: s.activeSiteId, name: name.trim(), price: Math.round(price), stock: 1, photo: s.products.length }, ...s.products] }));
      return { ok: true };
    },
    setModeration: (m) => set((s) => ({ ...s, moderation: m })),
    moderateReview(id, action) {
      set((s) => ({
        ...s,
        reviews:
          action === "delete"
            ? s.reviews.filter((r) => r.id !== id)
            : s.reviews.map((r) =>
                r.id !== id ? r : action === "approve" || action === "restore" ? { ...r, status: action === "approve" ? "published" : "pending", trashedAt: null } : { ...r, status: "trash", trashedAt: Date.now() },
              ),
      }));
    },
    installModule(id): ActionResult {
      const def = moduleCatalog.find((m) => m.id === id);
      if (!def || def.availability !== "available") return { ok: false, reason: "not_available" };
      if (state.modules.some((m) => m.id === id)) return { ok: true };
      const free = freeActive() && freeUsed() < state.subscription.freeModulesLimit;
      if (!free && state.balance < def.price) return { ok: false, reason: "insufficient_balance" };
      set((s) => ({ ...s, balance: free ? s.balance : s.balance - def.price, modules: [...s.modules, { id, installedAt: Date.now(), free }] }));
      notify("module", "moduleInstalled", { id });
      return { ok: true };
    },
    uninstallModule: (id) => set((s) => ({ ...s, modules: s.modules.filter((m) => m.id !== id) })),
    markAllRead: () => set((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
    completeRecommendation: (id) => set((s) => ({ ...s, recommendations: s.recommendations.map((r) => (r.id === id ? { ...r, done: true } : r)) })),
    updateCustomization: (patch) => set((s) => ({ ...s, customization: { ...s.customization, ...patch } })),
    runBackup() {
      set((s) => ({ ...s, backups: [{ id: nextId("b"), at: Date.now(), size: "48.4 MB", auto: false }, ...s.backups] }));
      notify("backup", "backupManual");
    },
    restoreBackup(id) {
      const b = state.backups.find((x) => x.id === id);
      if (b) notify("backup", "backupRestored", { at: b.at });
    },
    createTicket(category, text, screenshot): ActionResult {
      if (text.trim().length < 5) return { ok: false, reason: "invalid" };
      const number = 200 + state.tickets.length + 1;
      set((s) => ({ ...s, tickets: [{ id: nextId("t"), number, category, text: text.trim(), screenshot, status: "open", at: Date.now() }, ...s.tickets] }));
      notify("ticket", "ticket", { n: number });
      return { ok: true };
    },
    async connectIntegration() {
      await new Promise((r) => setTimeout(r, 700));
      return { ok: false, reason: "not_available" };
    },
    simulateLowBalance(on) {
      const days = config.subscription.graceDaysDefault;
      set((s) => ({
        ...s,
        balance: on ? 40 : 450,
        subscription: on
          ? { ...s.subscription, freeUntil: null, nextChargeAt: Date.now() - DAY, graceUntil: Date.now() + days * DAY }
          : { ...s.subscription, freeUntil: Date.now() + 64 * DAY, nextChargeAt: Date.now() + 64 * DAY, graceUntil: null },
      }));
      if (on) notify("balance", "lowBalance", { days });
    },
    setLive(on) {
      if (on && !timer) timer = setInterval(simulate, 14_000);
      if (!on && timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
  return client;
}
