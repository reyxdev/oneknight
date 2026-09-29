"use client";

import { useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, withLang } from "@/i18n";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import type { Me } from "@/lib/api";
import { Panel } from "@/features/oneknight/ui/kit";
import { Security } from "./Security";
import { AdminLeads, MyLeads } from "./Leads";

type Screen = "home" | "security" | "account" | "admin";
const NAV: { id: Screen; icon: IconName }[] = [
  { id: "home", icon: "home" },
  { id: "security", icon: "shield" },
  { id: "account", icon: "person" },
];

/** The real ONEKNIGHT account. Only sections backed by real data are shown; the rest arrive as they are built. */
export function AppPanel({ me, onLogout, onChange }: { me: Me; onLogout: () => void; onChange: () => void }) {
  const d = useDict();
  const t = d.app;
  const lang = useLang();
  const [screen, setScreen] = useState<Screen>("home");
  const org = me.organizations[0];
  const nav = me.isAdmin ? [...NAV, { id: "admin" as const, icon: "table" as IconName }] : NAV;
  const label = (id: Screen) => (id === "admin" ? t.admin.nav : t.nav[id]);

  return (
    <div className="app-shell">
      <div className="ok-app" data-accent="alby">
        <aside className="ok-side" aria-label={t.nav.sections}>
          <div className="ok-brand"><span className="ok-brand-mark"><KnightMark size={30} /></span><b>ONEKNIGHT</b></div>
          <nav>
            {nav.map((n) => (
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
          </header>
          <div className="ok-content" key={screen}>
            {screen === "home" && (
              <div className="ok-screen">
                <div className="ok-hello">
                  <h3>{fmt(t.home.hello, { name: me.name })}</h3>
                  <p>{t.home.lead}</p>
                </div>
                <div className="ok-grid-2">
                  <Panel title={t.home.siteTitle}><p className="ok-muted">{t.home.siteEmpty}</p></Panel>
                  <MyLeads />
                </div>
                <div className="ok-grid-2">
                  <Panel title={t.home.securityTitle}>
                    {me.totpEnabled ? (
                      <p className="ok-muted"><Icon name="check" size={15} /> {t.home.securityOn}</p>
                    ) : (
                      <>
                        <p className="ok-muted">{t.home.securityText}</p>
                        <button type="button" className="btn btn-sm btn-secondary" style={{ justifySelf: "start" }} onClick={() => setScreen("security")}>{t.home.securityCta}</button>
                      </>
                    )}
                  </Panel>
                  <Panel title={t.home.demoTitle}>
                    <p className="ok-muted">{t.home.demoText}</p>
                    <a className="btn btn-sm btn-secondary" style={{ justifySelf: "start" }} href={`${withLang(lang, "/")}#playground`}>{t.home.demoCta}</a>
                  </Panel>
                </div>
              </div>
            )}
            {screen === "security" && <Security me={me} onChange={onChange} />}
            {screen === "admin" && me.isAdmin && <AdminLeads />}
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
