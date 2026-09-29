"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import type { Me } from "@/lib/api";
import { AdminLeads } from "./Leads";
import { Toasts } from "./Toasts";
import { NewOrders } from "./NewOrders";
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
import { OrdersScreen, ProductsScreen } from "./Shop";
import { ReviewsScreen } from "./Reviews";
import { AnalyticsScreen } from "./Analytics";
import { HomeScreen } from "./Home";
import { TeamScreen } from "./Team";
import { api } from "@/lib/api";

type ClientScreen = "home" | "orders" | "products" | "reviews" | "analytics" | "site" | "modules" | "services" | "business" | "billing" | "team" | "profile" | "support";
type AdminScreen = "admin" | "clients" | "tickets" | "topups" | "keys";
type Screen = ClientScreen | AdminScreen;
type Item = { id: Screen; icon: IconName };

/** Menu groups (owner's decision): work, site, growth, settings. Profile and support sit at the bottom. */
const GROUPS: { key: "work" | "site" | "growth" | "settings"; items: Item[] }[] = [
  { key: "work", items: [{ id: "home", icon: "home" }, { id: "orders", icon: "cart" }, { id: "products", icon: "box" }, { id: "reviews", icon: "star" }, { id: "analytics", icon: "chart" }] },
  { key: "site", items: [{ id: "site", icon: "globe" }] },
  { key: "growth", items: [{ id: "modules", icon: "puzzle" }, { id: "services", icon: "layers" }] },
  { key: "settings", items: [{ id: "business", icon: "settings" }, { id: "billing", icon: "card" }, { id: "team", icon: "person" }] },
];
const FOOT: Item[] = [{ id: "profile", icon: "person" }, { id: "support", icon: "chat" }];
const ADMIN: Item[] = [{ id: "admin", icon: "table" }, { id: "clients", icon: "layers" }, { id: "tickets", icon: "chat" }, { id: "topups", icon: "card" }, { id: "keys", icon: "lock" }];
/** Phone bottom bar: the daily screens + «Ще». */
const MOBILE: Screen[] = ["home", "orders", "products"];

const CLIENT_SCREENS = new Set<Screen>([...GROUPS.flatMap((g) => g.items.map((i) => i.id)), ...FOOT.map((i) => i.id)]);
const ADMIN_SCREENS = new Set<Screen>(ADMIN.map((i) => i.id));
/** Old links keep working. */
const ALIASES: Record<string, string> = { account: "profile", security: "profile/security", integrations: "business/integrations" };
/** Module a section needs; without it the menu shows a lock (the screen explains and offers to connect). */
const MODULE_OF: Partial<Record<Screen, string>> = { reviews: "reviews", analytics: "analytics" };
/** Permission a section needs in the active business; the API enforces the same rules. */
const NEEDS: Partial<Record<Screen, string>> = { orders: "orders", products: "products", reviews: "reviews", analytics: "analytics", modules: "modules", billing: "billing", support: "support", team: "team" };

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
      services: t.servicesApp.nav,
      site: t.site.title,
      modules: t.modulesApp.nav,
      business: t.nav.business,
      billing: t.billing.nav,
      support: t.support.nav,
      team: t.team.nav,
      orders: t.orders.nav,
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
  // Browser tab: «(3) Замовлення · ONEKNIGHT» while orders wait for confirmation.
  useEffect(() => {
    const name = label(screen) ?? "";
    document.title = `${newCount ? `(${newCount}) ` : ""}${name} · ONEKNIGHT`;
  });
  const businessTab = (BUSINESS_TABS as string[]).includes(route.tab ?? "") ? (route.tab as BusinessTab) : "general";
  const profileTab = (PROFILE_TABS as string[]).includes(route.tab ?? "") ? (route.tab as ProfileTab) : "profile";

  return (
    <Toasts>
    {me.permissions.includes("orders") && <NewOrders go={(id, tab) => go(id as Screen, tab ?? null)} onCount={setNewCount} />}
    <div className="app-shell">
      <div className="ok-app" data-accent="alby" data-mode={adminMode ? "admin" : "business"}>
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
            <span className="ok-grow" />
            {me.isAdmin && (
              <button type="button" className="btn btn-sm btn-secondary app-mode" data-mode-switch data-admin={adminMode} onClick={() => go(adminMode ? "home" : "admin")}>
                <Icon name={adminMode ? "home" : "settings"} size={15} />
                {adminMode ? t.nav.modeBusiness : t.nav.modeAdmin}
              </button>
            )}
            <span className="app-user"><Icon name="person" size={16} />{me.email}</span>
            <Bell />
          </header>
          <div className="ok-content" key={`${me.activeOrgId}/${screen}/${route.tab ?? ""}`}>
            {!view && <p className="ok-muted">{screen === "business" ? t.business.ownerOnly : t.team.noAccess}</p>}
            {view === "home" && <HomeScreen me={me} go={(id, tab) => go(id as Screen, tab ?? null)} />}
            {view === "orders" && <OrdersScreen tab={route.tab} shippingOnly={!me.permissions.includes("orders")} />}
            {view === "products" && <ProductsScreen tab={route.tab} />}
            {view === "reviews" && <ReviewsScreen goModules={() => go("modules")} />}
            {view === "analytics" && <AnalyticsScreen goModules={() => go("modules")} />}
            {view === "site" && <SiteScreen canEdit={me.permissions.includes("site")} />}
            {view === "modules" && <ModulesScreen />}
            {view === "services" && <ServicesScreen />}
            {view === "business" && <BusinessScreen me={me} tab={businessTab} setTab={(tab) => go("business", tab)} onChange={onChange} />}
            {view === "billing" && <BillingScreen />}
            {view === "team" && <TeamScreen me={me} />}
            {view === "profile" && <ProfileScreen me={me} tab={profileTab} setTab={(tab) => go("profile", tab)} onChange={onChange} />}
            {view === "support" && <SupportScreen />}
            {adminMode && view === "admin" && <AdminLeads />}
            {adminMode && view === "clients" && <Clients />}
            {adminMode && view === "tickets" && <SupportScreen admin />}
            {adminMode && view === "topups" && <TopupsAdmin />}
            {adminMode && view === "keys" && <KeysAdmin />}
          </div>
        </div>
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
