"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import type { Me } from "@/lib/api";
import { AdminLeads } from "./Leads";
import { Toasts } from "./Toasts";
import { AnnouncementsAdmin, Banner, NewsButton, useAnnouncements } from "./Announcements";
import { applyTextSize } from "./textSize";
import { NewOrders } from "./NewOrders";
import { Search } from "./Search";
import { Modal } from "@/components/ui/Modal";
import { SiteScreen } from "./SiteScreen";
import { Clients } from "./Clients";
import { Bell } from "./Bell";
import { BillingScreen, ModulesScreen } from "./Billing";
import { TopupsAdmin } from "./TopupsAdmin";
import { KeysAdmin } from "./KeysAdmin";
import { PROFILE_TABS, ProfileScreen, type ProfileTab } from "./Profile";
import { BUSINESS_TABS, BusinessScreen, type BusinessTab } from "./Business";
import { ServicesScreen } from "./Services";
import { SupportScreen } from "./Support";
import { ProductsScreen } from "./Products";
import { OrdersScreen } from "./Orders";
import { CustomersScreen } from "./Customers";
import { ReviewsScreen } from "./Reviews";
import { AnalyticsScreen } from "./Analytics";
import { HomeScreen } from "./Home";
import { TeamScreen } from "./Team";
import { READ_ONLY, api } from "@/lib/api";

type ClientScreen = "home" | "orders" | "customers" | "products" | "reviews" | "analytics" | "site" | "modules" | "services" | "business" | "billing" | "team" | "profile" | "support";
type AdminScreen = "admin" | "clients" | "tickets" | "topups" | "keys" | "news";
type Screen = ClientScreen | AdminScreen;
type Item = { id: Screen; icon: IconName };

/** Menu groups (owner's decision): work, site, growth, settings. Profile and support sit at the bottom. */
const GROUPS: { key: "work" | "site" | "growth" | "settings"; items: Item[] }[] = [
  { key: "work", items: [{ id: "home", icon: "home" }, { id: "orders", icon: "cart" }, { id: "customers", icon: "person" }, { id: "products", icon: "box" }, { id: "reviews", icon: "star" }, { id: "analytics", icon: "chart" }] },
  { key: "site", items: [{ id: "site", icon: "globe" }] },
  { key: "growth", items: [{ id: "modules", icon: "puzzle" }, { id: "services", icon: "layers" }] },
  { key: "settings", items: [{ id: "business", icon: "settings" }, { id: "billing", icon: "card" }, { id: "team", icon: "person" }] },
];
const FOOT: Item[] = [{ id: "profile", icon: "person" }, { id: "support", icon: "chat" }];
const ADMIN: Item[] = [{ id: "admin", icon: "table" }, { id: "clients", icon: "layers" }, { id: "tickets", icon: "chat" }, { id: "topups", icon: "card" }, { id: "keys", icon: "lock" }, { id: "news", icon: "megaphone" }];
/** Phone bottom bar: the daily screens + «Ще». */
const MOBILE: Screen[] = ["home", "orders", "products"];

const CLIENT_SCREENS = new Set<Screen>([...GROUPS.flatMap((g) => g.items.map((i) => i.id)), ...FOOT.map((i) => i.id)]);
const ADMIN_SCREENS = new Set<Screen>(ADMIN.map((i) => i.id));
/** Old links keep working. */
const ALIASES: Record<string, string> = { account: "profile", security: "profile/security", integrations: "business/integrations" };
/** Module a section needs; without it the menu shows a lock (the screen explains and offers to connect). */
const MODULE_OF: Partial<Record<Screen, string>> = { reviews: "reviews", analytics: "analytics" };
/** Permission a section needs in the active business; the API enforces the same rules. */
const NEEDS: Partial<Record<Screen, string>> = { orders: "orders", customers: "orders", products: "products", reviews: "reviews", analytics: "analytics", modules: "modules", billing: "billing", support: "support", team: "team" };

type Route = { screen: Screen; tab: string | null };
function readHash(isAdmin: boolean): Route {
  if (typeof window === "undefined") return { screen: "home", tab: null };
  const raw = window.location.hash.slice(1);
  const [s, tab] = (ALIASES[raw] ?? raw).split("/") as [Screen, string | undefined];
  if (CLIENT_SCREENS.has(s) || (isAdmin && ADMIN_SCREENS.has(s))) return { screen: s, tab: tab ?? null };
  return { screen: "home", tab: null };
}

export function AppPanel({ me, onLogout, onChange }: { me: Me; onLogout: () => void; onChange: () => void }) {
  const d = useDict();
  const t = d.app;
  const lang = useLang();
  // The current section (and tab) lives in the URL hash: refresh, back/forward and direct links keep it.
  const [route, setRoute] = useState<Route>(() => readHash(me.isAdmin));
  const [more, setMore] = useState(false);
  const go = useCallback((screen: Screen, tab: string | null = null) => {
    setRoute({ screen, tab });
    setMore(false);
    const hash = screen === "home" && !tab ? "" : `#${screen}${tab ? `/${tab}` : ""}`;
    if (location.hash !== hash) history.pushState(null, "", hash || location.pathname + location.search);
  }, []);
  useEffect(() => {
    const on = () => setRoute(readHash(me.isAdmin));
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, [me.isAdmin]);

  const [newCount, setNewCount] = useState(0);
  const news = useAnnouncements();
  // «Лише перегляд»: suspended or cancelled, or answered the questions without any subscription (trial used).
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const on = () => setBlocked(true);
    window.addEventListener(READ_ONLY, on);
    return () => window.removeEventListener(READ_ONLY, on);
  }, []);
  const readOnly = blocked || me.subscription?.status === "suspended" || me.subscription?.status === "cancelled" || (!me.subscription && me.onboarded && me.role === "owner");
  const { screen } = route;
  const adminMode = me.isAdmin && ADMIN_SCREENS.has(screen);
  const org = me.organizations.find((o) => o.id === me.activeOrgId) ?? me.organizations[0];
  // Orders: everything with `orders`, orders waiting to be sent with `shipping` («Комплектувальник»).
  const allowed = (id: Screen) => (id === "business" ? me.role === "owner" : id === "orders" ? me.permissions.includes("orders") || me.permissions.includes("shipping") : !NEEDS[id] || me.permissions.includes(NEEDS[id]!));
  const locked = (id: Screen) => !!MODULE_OF[id] && !me.modules.includes(MODULE_OF[id]!);
  const view: Screen | null = allowed(screen) ? screen : null;
  const label = (id: Screen) =>
    ({
      home: t.nav.home,
      admin: t.admin.nav,
      clients: t.clients.nav,
      tickets: t.supportAdmin.nav,
      topups: t.topupsAdmin.nav,
      keys: t.keysAdmin.nav,
      news: t.newsAdmin.nav,
      services: t.servicesApp.nav,
      site: t.site.title,
      modules: t.modulesApp.nav,
      business: t.nav.business,
      billing: t.billing.nav,
      support: t.support.nav,
      team: t.team.nav,
      orders: t.orders.nav,
      customers: t.customers.nav,
      products: t.products.nav,
      reviews: t.reviews.nav,
      analytics: t.analytics.nav,
      profile: t.nav.myProfile,
    })[id];
  const navBtn = (n: Item) => (
    <button key={n.id} type="button" className="ok-navbtn" aria-current={screen === n.id ? "page" : undefined} onClick={() => go(n.id)}>
      <Icon name={n.icon} size={19} />
      <span>{label(n.id)}</span>
      {locked(n.id) && <Icon name="lock" size={14} className="app-nav-lock" aria-label={t.nav.locked} />}
    </button>
  );
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.id)) })).filter((g) => g.items.length > 0);
  const foot = FOOT.filter((i) => allowed(i.id));
  // Keys: «/» search, «N» new (on a screen that has it), «?» the list of keys. Not while typing in a field.
  const searchRef = useRef<HTMLInputElement>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => applyTextSize(), []);
  // «Приховати суми й телефони» (showing the screen to someone, a café): remembered on this device.
  const [secret, setSecret] = useState(false);
  useEffect(() => {
    try {
      setSecret(localStorage.getItem("ok.private") === "1");
    } catch {}
  }, []);
  const toggleSecret = () =>
    setSecret((v) => {
      try {
        localStorage.setItem("ok.private", v ? "0" : "1");
      } catch {}
      return !v;
    });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable='true'], dialog[open]")) return;
      if (e.code === "Slash" && e.shiftKey) {
        e.preventDefault();
        setKeysOpen(true);
      } else if (e.code === "Slash" && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      } else if (e.code === "KeyN" && !e.shiftKey && screen === "products" && allowed("products")) {
        e.preventDefault();
        go("products", "new");
      } else if (e.code === "KeyN" && !e.shiftKey && screen === "orders" && me.permissions.includes("orders")) {
        e.preventDefault();
        go("orders", "new-order");
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  // Browser tab: «(3) Замовлення · ONEKNIGHT» while orders wait for confirmation.
  useEffect(() => {
    const name = label(screen) ?? "";
    document.title = `${newCount ? `(${newCount}) ` : ""}${name} · ONEKNIGHT`;
  });
  const businessTab = (BUSINESS_TABS as string[]).includes(route.tab ?? "") ? (route.tab as BusinessTab) : "general";
  const profileTab = (PROFILE_TABS as string[]).includes(route.tab ?? "") ? (route.tab as ProfileTab) : "profile";

  return (
    <Toasts>
    <Modal open={keysOpen} onClose={() => setKeysOpen(false)} labelledBy="ok-keys">
      <div className="app-dialog">
      <h2 id="ok-keys" className="app-neworders-title">{t.keys.title}</h2>
      <dl className="app-keys">
        {(
          [
            ["/", t.keys.search],
            ["N", t.keys.new],
            ["↑ ↓ Enter", t.keys.arrows],
            ["Esc", t.keys.esc],
            ["?", t.keys.help],
          ] as const
        ).map(([k, v]) => (
          <div key={k}><dt><kbd className="app-kbd">{k}</kbd></dt><dd>{v}</dd></div>
        ))}
      </dl>
      </div>
    </Modal>
    {me.permissions.includes("orders") && <NewOrders go={(id, tab) => go(id as Screen, tab ?? null)} onCount={setNewCount} />}
    <div className="app-shell">
      <div className="ok-app" data-accent="alby" data-mode={adminMode ? "admin" : "business"} data-private={secret || undefined}>
        <aside className="ok-side" aria-label={t.nav.sections}>
          <div className="ok-brand"><span className="ok-brand-mark"><KnightMark size={30} /></span><b>ONEKNIGHT</b></div>
          <nav>
            {adminMode ? (
              <>
                <span className="app-nav-sep">{t.nav.modeAdmin}</span>
                {ADMIN.map(navBtn)}
              </>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="app-nav-group" role="group" aria-label={t.nav.groups[g.key]}>
                  <span className="app-nav-sep">{t.nav.groups[g.key]}</span>
                  {g.items.map(navBtn)}
                </div>
              ))
            )}
          </nav>
          <div className="app-side-foot">
            {!adminMode && foot.map(navBtn)}
            {!adminMode && news.data && <NewsButton data={news.data} onSeen={() => void news.load()} />}
            <a className="ok-navbtn" href={withLang(lang, "/")}><Icon name="globe" size={19} /><span>{t.nav.site}</span></a>
            <button type="button" className="ok-navbtn" onClick={onLogout}><Icon name="arrow" size={19} style={{ transform: "scaleX(-1)" }} /><span>{t.nav.logout}</span></button>
          </div>
        </aside>
        <div className="ok-main">
          <header className="ok-top">
            {!adminMode && me.organizations.length > 1 ? (
              <label className="ok-site">
                <span className="sr-only">{t.team.business}</span>
                <Icon name="layers" size={16} />
                <select value={me.activeOrgId ?? ""} onChange={async (e) => { await api("/auth/org", { method: "POST", body: { orgId: e.target.value } }); go("home"); onChange(); }}>
                  {me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name} · {t.team.roles[o.role]}</option>)}
                </select>
              </label>
            ) : (
              <b className="app-org">{adminMode ? t.nav.modeAdmin : org?.name ?? me.name}</b>
            )}
            {!adminMode && (allowed("orders") || allowed("products")) ? <Search go={(id, tab) => go(id as Screen, tab ?? null)} inputRef={searchRef} /> : <span className="ok-grow" />}
            {!adminMode && me.subscription?.status === "trial" && allowed("billing") && (
              <button type="button" className="app-trial" onClick={() => go("billing")}>
                {fmt(t.billing.trialBadge, { n: Math.max(0, Math.ceil((new Date(me.subscription.periodEnd).getTime() - Date.now()) / 86_400_000)) })}
              </button>
            )}
            {!adminMode && (
              <button type="button" className="btn btn-sm btn-ghost btn-icon app-secret-btn" aria-pressed={secret} aria-label={t.nav.hideSums} title={t.nav.hideSums} onClick={toggleSecret}>
                <Icon name="eye" size={17} />
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost btn-icon app-keys-btn" aria-label={t.keys.title} title={t.keys.title} onClick={() => setKeysOpen(true)}>?</button>
            {me.isAdmin && (
              <button type="button" className="btn btn-sm btn-secondary app-mode" data-mode-switch data-admin={adminMode} onClick={() => go(adminMode ? "home" : "admin")}>
                <Icon name={adminMode ? "home" : "settings"} size={15} />
                {adminMode ? t.nav.modeBusiness : t.nav.modeAdmin}
              </button>
            )}
            <span className="app-user"><Icon name="person" size={16} />{me.email}</span>
            <Bell />
          </header>
          {!adminMode && readOnly && (
            <div className="app-banner app-readonly" role="alert">
              <Icon name="lock" size={18} />
              <span className="ok-grow"><b>{t.readOnly.title}</b> {me.subscription ? t.readOnly.suspended : t.readOnly.noTrial}</span>
              {allowed("billing") && <button type="button" className="btn btn-sm" onClick={() => go("billing")}>{t.readOnly.pay}</button>}
            </div>
          )}
          {!adminMode && news.data?.banner && <Banner item={news.data.banner} onClose={() => void news.load()} />}
          <div className="ok-content" key={`${me.activeOrgId}/${screen}/${route.tab ?? ""}`}>
            {!view && <p className="ok-muted">{screen === "business" ? t.business.ownerOnly : t.team.noAccess}</p>}
            {view === "home" && <HomeScreen me={me} go={(id, tab) => go(id as Screen, tab ?? null)} />}
            {view === "orders" && <OrdersScreen tab={route.tab} shippingOnly={!me.permissions.includes("orders")} finance={me.permissions.includes("finance")} meName={me.name} />}
            {view === "customers" && <CustomersScreen tab={route.tab} finance={me.permissions.includes("finance")} go={(id, tab) => go(id as Screen, tab ?? null)} />}
            {view === "products" && <ProductsScreen tab={route.tab} finance={me.permissions.includes("finance")} />}
            {view === "reviews" && <ReviewsScreen goModules={() => go("modules")} />}
            {view === "analytics" && <AnalyticsScreen goModules={() => go("modules")} />}
            {view === "site" && <SiteScreen canEdit={me.permissions.includes("site")} />}
            {view === "modules" && <ModulesScreen />}
            {view === "services" && <ServicesScreen />}
            {view === "business" && <BusinessScreen me={me} tab={businessTab} setTab={(tab) => go("business", tab)} onChange={onChange} />}
            {view === "billing" && <BillingScreen onChange={onChange} />}
            {view === "team" && <TeamScreen me={me} />}
            {view === "profile" && <ProfileScreen me={me} tab={profileTab} setTab={(tab) => go("profile", tab)} onChange={onChange} />}
            {view === "support" && <SupportScreen />}
            {adminMode && view === "admin" && <AdminLeads />}
            {adminMode && view === "clients" && <Clients />}
            {adminMode && view === "tickets" && <SupportScreen admin />}
            {adminMode && view === "topups" && <TopupsAdmin />}
            {adminMode && view === "keys" && <KeysAdmin />}
            {adminMode && view === "news" && <AnnouncementsAdmin />}
          </div>
        </div>
        {!adminMode && (me.permissions.includes("orders") || allowed("products")) && screen !== "products" && (
          <button
            type="button"
            className="app-fab"
            aria-label={me.permissions.includes("orders") ? t.orders.addOrder : t.products.add}
            title={me.permissions.includes("orders") ? t.orders.addOrder : t.products.add}
            onClick={() => (me.permissions.includes("orders") ? go("orders", "new-order") : go("products", "new"))}
          >
            <Icon name="plus" size={24} />
          </button>
        )}
        <nav className="ok-bottom" aria-label={t.nav.sections}>
          {(adminMode ? ADMIN : MOBILE.filter(allowed).map((id) => [...GROUPS.flatMap((g) => g.items)].find((i) => i.id === id)!)).map((n) => (
            <button key={n.id} type="button" aria-current={screen === n.id ? "page" : undefined} onClick={() => go(n.id)}>
              <Icon name={n.icon} size={20} /><span>{label(n.id)}</span>
            </button>
          ))}
          {!adminMode && (
            <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name="layers" size={20} /><span>{t.nav.more}</span>
            </button>
          )}
        </nav>
        {more && !adminMode && (
          <div className="app-more" role="dialog" aria-label={t.nav.more}>
            {groups.map((g) => (
              <div key={g.key} className="app-nav-group">
                <span className="app-nav-sep">{t.nav.groups[g.key]}</span>
                {g.items.filter((i) => !MOBILE.includes(i.id)).map(navBtn)}
              </div>
            ))}
            <div className="app-nav-group">
              {foot.map(navBtn)}
              <button type="button" className="ok-navbtn" onClick={onLogout}><Icon name="arrow" size={19} style={{ transform: "scaleX(-1)" }} /><span>{t.nav.logout}</span></button>
            </div>
          </div>
        )}
      </div>
    </div>
    </Toasts>
  );
}
