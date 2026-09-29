"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDict } from "@/i18n/provider";
import { Icon, type IconName } from "@/components/ui/Icon";
import { KnightMark } from "@/components/global/Logo";
import { playSound } from "@/lib/sound";
import { useClient, useOkState } from "../state";
import { notifText, useFormat } from "./kit";
import type { ModuleId } from "@oneknight/domain";

export type ScreenId = "home" | "orders" | "site" | "analytics" | "products" | "reviews" | "modules" | "integrations" | "services" | "support" | "account" | "settings";

type NavDef = { id: ScreenId; icon: IconName; module?: ModuleId };
export const NAV: NavDef[] = [
  { id: "home", icon: "home" },
  { id: "orders", icon: "cart" },
  { id: "site", icon: "globe" },
  { id: "analytics", icon: "chart", module: "analytics" },
  { id: "products", icon: "box" },
  { id: "reviews", icon: "star", module: "reviews" },
  { id: "modules", icon: "puzzle" },
  { id: "integrations", icon: "link" },
  { id: "services", icon: "layers" },
  { id: "support", icon: "chat" },
  { id: "account", icon: "card" },
  { id: "settings", icon: "settings" },
];
const MOBILE_MAIN: ScreenId[] = ["home", "orders", "site", "reviews"];

export function Shell({ screen, go, children }: { screen: ScreenId; go: (s: ScreenId) => void; children: ReactNode }) {
  const t = useDict().ok;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [collapsed, setCollapsed] = useState(false);
  const [bell, setBell] = useState(false);
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const installed = new Set(s.modules.map((m) => m.id));
  const nav = NAV.filter((n) => !n.module || installed.has(n.module));
  const unread = s.notifications.filter((n) => !n.read).length;
  const text = (n: (typeof s.notifications)[number]) => notifText(t.notif, n);

  useEffect(() => {
    return client.onEvent((e) => {
      const n = client.getState().notifications.find((x) => x.id === e.id);
      if (!n) return;
      playSound("notify");
      setToast(notifText(t.notif, n));
    });
  }, [client, t.notif]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!bell) return;
    const close = (e: PointerEvent) => !bellRef.current?.contains(e.target as Node) && setBell(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setBell(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [bell]);

  const select = (id: ScreenId) => {
    go(id);
    setMore(false);
  };

  return (
    <div className="ok-app" data-collapsed={collapsed} data-accent={s.customization.accent}>
      <aside className="ok-side" aria-label={t.nav.sections}>
        <div className="ok-brand">
          <span className="ok-brand-mark"><KnightMark size={30} /></span>
          <b>ONEKNIGHT</b>
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.id} type="button" className="ok-navbtn" aria-current={screen === n.id ? "page" : undefined} onClick={() => select(n.id)} title={collapsed ? t.nav[n.id] : undefined}>
              <Icon name={n.icon} size={19} />
              <span>{t.nav[n.id]}</span>
              {n.id === "orders" && s.orders.some((o) => o.status === "new") && <i className="ok-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <button type="button" className="ok-navbtn ok-collapse" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? t.nav.expand : t.nav.collapse} aria-expanded={!collapsed}>
          <Icon name="arrow" size={18} style={{ transform: collapsed ? "none" : "scaleX(-1)" }} />
          <span>{t.nav.collapse}</span>
        </button>
      </aside>

      <div className="ok-main">
        <header className="ok-top">
          <label className="ok-site">
            <span className="sr-only">{t.top.site}</span>
            <Icon name="globe" size={16} />
            <select value={s.activeSiteId} onChange={(e) => client.setActiveSite(e.target.value)}>
              {s.sites.map((x) => (
                <option key={x.id} value={x.id}>{x.domain}</option>
              ))}
            </select>
          </label>
          <span className="ok-demo-badge"><i />{t.demoBadge}</span>
          <button type="button" className="ok-balance" onClick={() => select("account")}>
            <span>{t.top.balance}</span>
            <b className="num">{f.money(s.balance)}</b>
          </button>
          <div className="ok-bell" ref={bellRef}>
            <button type="button" className="ok-iconbtn" aria-label={`${t.top.notifications}: ${unread}`} aria-expanded={bell} onClick={() => setBell((v) => !v)}>
              <Icon name="bell" size={19} />
              {unread > 0 && <span className="ok-badge num" key={unread}>{unread}</span>}
            </button>
            {bell && (
              <div className="ok-pop" role="dialog" aria-label={t.top.notifications}>
                <header>
                  <b>{t.top.notifications}</b>
                  <button type="button" className="ok-link" onClick={() => client.markAllRead()} disabled={!unread}>{t.top.markAll}</button>
                </header>
                {s.notifications.length === 0 ? (
                  <p className="ok-muted">{t.top.empty}</p>
                ) : (
                  <ul>
                    {s.notifications.slice(0, 8).map((n) => (
                      <li key={n.id} data-read={n.read}>
                        <span>{text(n)}</span>
                        <small>{f.ago(n.at)}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="ok-content" key={screen}>{children}</div>

        {toast && (
          <div className="ok-toast" data-style={s.customization.notice} role="status">
            <Icon name="bell" size={16} />
            {toast}
          </div>
        )}
      </div>

      <nav className="ok-bottom" aria-label={t.nav.sections}>
        {MOBILE_MAIN.filter((id) => nav.some((n) => n.id === id)).map((id) => {
          const n = NAV.find((x) => x.id === id)!;
          return (
            <button key={id} type="button" aria-current={screen === id ? "page" : undefined} onClick={() => select(id)}>
              <Icon name={n.icon} size={20} />
              <span>{t.nav[id]}</span>
            </button>
          );
        })}
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} aria-current={!MOBILE_MAIN.includes(screen) ? "page" : undefined}>
          <Icon name="layers" size={20} />
          <span>{t.nav.more}</span>
        </button>
        {more && (
          <div className="ok-more">
            {nav.filter((n) => !MOBILE_MAIN.includes(n.id)).map((n) => (
              <button key={n.id} type="button" onClick={() => select(n.id)} aria-current={screen === n.id ? "page" : undefined}>
                <Icon name={n.icon} size={18} />
                {t.nav[n.id]}
              </button>
            ))}
          </div>
        )}
      </nav>
    </div>
  );
}
