import type { OkState } from "../domain";
import { oneknightPricing } from "@/data/pricing";

/**
 * DEMO DATA. Fictional business, fictional customers, fictional numbers.
 * Nothing here is a real client or a real result.
 */
const DAY = 86_400_000;

export function seed(now: number, lang: "uk" | "en"): OkState {
  const uk = lang === "uk";
  const names = uk
    ? ["Олена К.", "Андрій М.", "Ірина П.", "Тарас Г.", "Марія Л.", "Богдан С.", "Наталія В."]
    : ["Olena K.", "Andrii M.", "Iryna P.", "Taras H.", "Mariia L.", "Bohdan S.", "Nataliia V."];
  const productNames = uk
    ? ["Хлібниця «Маки»", "Дошка з горіха", "Ключниця «Дім»", "Підставка для спецій", "Фруктівниця"]
    : ["Bread box \"Poppies\"", "Walnut board", "Key holder \"Home\"", "Spice rack", "Fruit bowl"];
  const products = productNames.map((name, i) => ({ id: `p${i + 1}`, siteId: "s1", name, price: [1100, 650, 480, 520, 700][i]!, stock: [6, 12, 2, 9, 0][i]!, photo: i }));
  const ord = (n: number, c: number, p: number[], status: OkState["orders"][number]["status"], hoursAgo: number, delivery: "novaposhta" | "ukrposhta" | "pickup") => {
    const items = p.map((idx) => ({ productId: products[idx]!.id, qty: 1, price: products[idx]!.price }));
    return {
      id: `o${n}`, siteId: "s1", number: 1040 + n, customer: names[c]!, phone: "+380 •• ••• •• " + String(10 + n).slice(-2),
      items, total: items.reduce((s, x) => s + x.price * x.qty, 0), status, delivery, payment: "cod" as const,
      warranty: { enabled: false, until: null, note: null }, createdAt: now - hoursAgo * 3_600_000, waybill: null,
    };
  };
  const series = Array.from({ length: 30 }, (_, i) => {
    const base = 120 + i * 3 + Math.round(Math.sin(i * 0.9) * 22) + (i > 23 ? 40 : 0);
    return { day: i, visits: base, orders: Math.max(1, Math.round(base / 55 + Math.cos(i) * 1.2)) };
  });
  return {
    demo: true,
    userName: uk ? "Іване" : "Ivan",
    sites: [
      { id: "s1", domain: "vash-biznes.ua", status: "up" },
      { id: "s2", domain: "druhyi-biznes.ua", status: "up" },
    ],
    activeSiteId: "s1",
    members: [
      { id: "m1", name: uk ? "Іван" : "Ivan", role: "owner", permissions: ["orders", "products", "reviews", "analytics", "site", "modules", "billing", "team"] },
      { id: "m2", name: uk ? "Оксана" : "Oksana", role: "manager", permissions: ["orders", "products", "reviews"] },
      { id: "m3", name: uk ? "Дмитро" : "Dmytro", role: "marketer", permissions: ["analytics", "reviews"] },
    ],
    orders: [
      ord(1, 0, [0], "new", 0.4, "novaposhta"),
      ord(2, 1, [1, 3], "new", 1.5, "novaposhta"),
      ord(3, 2, [2], "confirmed", 4, "ukrposhta"),
      ord(4, 3, [0, 4], "paid", 9, "novaposhta"),
      ord(5, 4, [3], "shipped", 26, "novaposhta"),
      ord(6, 5, [1], "done", 50, "pickup"),
      ord(7, 6, [2], "cancelled", 70, "novaposhta"),
    ],
    products,
    reviews: [
      { id: "r1", siteId: "s1", author: names[4]!, rating: 5, text: uk ? "Хлібниця ще краща, ніж на фото. Розпис живий, пахне деревом." : "The bread box is even better than in the photos. The painting feels alive.", productId: "p1", consent: true, hasPhoto: true, status: "published", createdAt: now - 3 * DAY, trashedAt: null },
      { id: "r2", siteId: "s1", author: names[5]!, rating: 5, text: uk ? "Швидко відправили, все акуратно запаковано." : "Shipped quickly, packed carefully.", productId: "p2", consent: true, hasPhoto: false, status: "pending", createdAt: now - 5 * 3_600_000, trashedAt: null },
      { id: "r3", siteId: "s1", author: names[6]!, rating: 4, text: uk ? "Гарна річ, але чекала довше, ніж думала." : "Nice item, but I waited longer than I expected.", productId: "p3", consent: true, hasPhoto: false, status: "pending", createdAt: now - 20 * 3_600_000, trashedAt: null },
      { id: "r4", siteId: "s1", author: "—", rating: 1, text: uk ? "Спам-посилання" : "Spam link", productId: null, consent: false, hasPhoto: false, status: "trash", createdAt: now - 9 * DAY, trashedAt: now - 8 * DAY },
    ],
    moderation: "manual",
    modules: [
      { id: "reviews", installedAt: now - 20 * DAY, free: true },
      { id: "analytics", installedAt: now - 20 * DAY, free: true },
    ],
    balance: 450,
    subscription: {
      plan: "oneknight",
      price: oneknightPricing.perMonth,
      freeUntil: now + 64 * DAY,
      freeModulesLimit: oneknightPricing.freeModules,
      graceUntil: null,
      nextChargeAt: now + 64 * DAY,
    },
    integrations: (["google", "meta", "telegram", "novaposhta", "ukrposhta", "prom", "olx", "rozetka"] as const).map((id) => ({ id, status: "not_connected" as const })),
    notifications: [
      { id: "n1", kind: "order", key: "order", vars: { n: 1041 }, at: now - 0.4 * 3_600_000, read: false },
      { id: "n2", kind: "review", key: "review", vars: { name: names[5]! }, at: now - 5 * 3_600_000, read: false },
      { id: "n3", kind: "backup", key: "backup", vars: {}, at: now - 10 * 3_600_000, read: true },
    ],
    recommendations: [
      { id: "rc1", key: "conversionDrop", tone: "warn", value: 18, done: false },
      { id: "rc2", key: "instagramUp", tone: "good", value: 34, done: false },
    ],
    checks: [
      { id: "uptime", state: "ok", value: "99.9%" },
      { id: "ssl", state: "ok", value: "74" },
      { id: "speed", state: "warn", value: "2.8" },
      { id: "api", state: "ok", value: "OK" },
      { id: "errors", state: "ok", value: "0" },
    ],
    backups: [0, 1, 2, 3].map((i) => ({ id: `b${i}`, at: now - (i * DAY + 10 * 3_600_000), size: `${(48.2 - i * 0.6).toFixed(1)} MB`, auto: true })),
    tickets: [],
    customization: { buttonAnim: "lift", hover: "glow", sound: "soft", notice: "toast", accent: "alby" },
    analytics: {
      series,
      sources: [
        { id: "ig", channel: "Instagram", campaign: "Reel 17", visits: 240, leads: 18, sales: 4 },
        { id: "g", channel: "Google", campaign: "search", visits: 180, leads: 7, sales: 4 },
        { id: "tg", channel: "Telegram", campaign: "post", visits: 120, leads: 4, sales: 3 },
        { id: "d", channel: "direct", campaign: "", visits: 100, leads: 2, sales: 1 },
      ],
    },
  };
}
