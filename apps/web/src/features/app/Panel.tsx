"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { withLang } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import type { Me } from "@/lib/api";
import { Panel } from "@/features/oneknight/ui/kit";
import { Security } from "./Security";
import { AdminLeads } from "./Leads";
import { SiteScreen } from "./SiteScreen";
import { Clients } from "./Clients";
import { Bell } from "./Bell";
import { BillingScreen, ModulesScreen } from "./Billing";
import { TopupsAdmin } from "./TopupsAdmin";
import { SupportScreen } from "./Support";
import { OrdersScreen, ProductsScreen } from "./Shop";
import { ReviewsScreen } from "./Reviews";
import { AnalyticsScreen } from "./Analytics";
import { HomeScreen } from "./Home";

type Screen = "home" | "orders" | "products" | "reviews" | "analytics" | "site" | "modules" | "billing" | "support" | "security" | "account" | "admin" | "clients" | "topups" | "tickets";
const NAV: { id: Screen; icon: IconName }[] = [
  { id: "home", icon: "home" },
  { id: "orders", icon: "cart" },
  { id: "products", icon: "box" },
  { id: "reviews", icon: "star" },
  { id: "analytics", icon: "chart" },
  { id: "site", icon: "globe" },
  { id: "modules", icon: "puzzle" },
  { id: "billing", icon: "card" },
  { id: "support", icon: "chat" },
  { id: "security", icon: "shield" },
  { id: "account", icon: "person" },
];

const SCREENS: Screen[] = ["home", "orders", "products", "reviews", "analytics", "site", "modules", "billing", "support", "security", "account"];
const ADMIN_SCREENS: Screen[] = ["admin", "tickets", "clients", "topups"];
function readHash(isAdmin: boolean): Screen {
  if (typeof window === "undefined") return "home";
  const h = window.location.hash.slice(1) as Screen;
  return SCREENS.includes(h) || (isAdmin && ADMIN_SCREENS.includes(h)) ? h : "home";
}

/** The real ONEKNIGHT account. Only sections backed by real data are shown; the rest arrive as they are built. */
export function AppPanel({ me, onLogout, onChange }: { me: Me; onLogout: () => void; onChange: () => void }) {
  const d = useDict();
  const t = d.app;
  const lang = useLang();
  // The current section lives in the URL hash: refresh, back/forward and direct links keep it.
  const [screen, setScreenState] = useState<Screen>(() => readHash(me.isAdmin));
  const setScreen = useCallback((id: Screen) => {
    setScreenState(id);
    if (location.hash.slice(1) !== id) history.pushState(null, "", id === "home" ? location.pathname + location.search : `#${id}`);
  }, []);
  useEffect(() => {
    const on = () => setScreenState(readHash(me.isAdmin));
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, [me.isAdmin]);
  const org = me.organizations[0];
  const adminNav: { id: Screen; icon: IconName }[] = me.isAdmin
    ? [{ id: "admin", icon: "table" }, { id: "tickets", icon: "chat" }, { id: "clients", icon: "layers" }, { id: "topups", icon: "card" }]
    : [];
  const nav = [...NAV, ...adminNav];
  const label = (id: Screen) =>
    ({ admin: t.admin.nav, clients: t.clients.nav, topups: t.topupsAdmin.nav, site: t.site.title, modules: t.modulesApp.nav, billing: t.billing.nav, support: t.support.nav, orders: t.orders.nav, products: t.products.nav, reviews: t.reviews.nav, analytics: t.analytics.nav, tickets: t.supportAdmin.nav } as Partial<Record<Screen, string>>)[id] ?? t.nav[id as "home" | "security" | "account"];

  return (
    <div className="app-shell">
      <div className="ok-app" data-accent="alby">
        <aside className="ok-side" aria-label={t.nav.sections}>
          <div className="ok-brand"><span className="ok-brand-mark"><KnightMark size={30} /></span><b>ONEKNIGHT</b></div>
          <nav>
            {NAV.map((n) => (
              <button key={n.id} type="button" className="ok-navbtn" aria-current={screen === n.id ? "page" : undefined} onClick={() => setScreen(n.id)}>
                <Icon name={n.icon} size={19} /><span>{label(n.id)}</span>
              </button>
            ))}
            {adminNav.length > 0 && <span className="app-nav-sep">{t.nav.adminSection}</span>}
            {adminNav.map((n) => (
              <button key={n.id} type="button" className="ok-navbtn" aria-current={screen === n.id ? "page" : undefined} onClick={() => setScreen(n.id)}>
                <Icon name={n.icon} size={19} /><span>{label(n.id)}</span>
              </button>
            ))}
          </nav>
          <div className="app-side-foot">
            <a className="ok-navbtn" href={withLang(lang, "/")}><Icon name="globe" size={19} /><span>{t.nav.site}</span></a>
            <button type="button" className="ok-navbtn" onClick={onLogout}><Icon name="arrow" size={19} style={{ transform: "scaleX(-1)" }} /><span>{t.nav.logout}</span></button>
          </div>
        </aside>
        <div className="ok-main">
          <header className="ok-top">
            <b className="app-org">{org?.name ?? me.name}</b>
            <span className="ok-grow" />
            <span className="app-user"><Icon name="person" size={16} />{me.email}</span>
            <Bell />
          </header>
          <div className="ok-content" key={screen}>
            {screen === "home" && <HomeScreen me={me} go={(id) => setScreen(id as Screen)} />}
            {screen === "security" && <Security me={me} onChange={onChange} />}
            {screen === "admin" && me.isAdmin && <AdminLeads />}
            {screen === "clients" && me.isAdmin && <Clients />}
            {screen === "site" && <SiteScreen />}
            {screen === "billing" && <BillingScreen />}
            {screen === "modules" && <ModulesScreen />}
            {screen === "topups" && me.isAdmin && <TopupsAdmin />}
            {screen === "support" && <SupportScreen />}
            {screen === "orders" && <OrdersScreen />}
            {screen === "products" && <ProductsScreen />}
            {screen === "reviews" && <ReviewsScreen goModules={() => setScreen("modules")} />}
            {screen === "analytics" && <AnalyticsScreen goModules={() => setScreen("modules")} />}
            {screen === "tickets" && me.isAdmin && <SupportScreen admin />}
            {screen === "account" && (
              <div className="ok-screen">
                <div className="ok-h"><h3>{t.account.title}</h3></div>
                <Panel>
                  <div className="ok-kv">
                    <div><span>{t.account.name}</span><b>{me.name}</b></div>
                    <div><span>{t.account.email}</span><b>{me.email}</b></div>
                    <div><span>{t.account.phone}</span><b>{me.phone}</b></div>
                    {org && <div><span>{t.account.business}</span><b>{org.name} · {t.account.roles[org.role]}</b></div>}
                  </div>
                  <p className="ok-muted">{t.account.note}</p>
                </Panel>
              </div>
            )}
          </div>
        </div>
        <nav className="ok-bottom" aria-label={t.nav.sections}>
          {nav.map((n) => (
            <button key={n.id} type="button" aria-current={screen === n.id ? "page" : undefined} onClick={() => setScreen(n.id)}>
              <Icon name={n.icon} size={20} /><span>{label(n.id)}</span>
            </button>
          ))}
          <button type="button" onClick={onLogout}><Icon name="arrow" size={20} style={{ transform: "scaleX(-1)" }} /><span>{t.nav.logout}</span></button>
        </nav>
      </div>
    </div>
  );
}
