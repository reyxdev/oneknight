"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { api, type Me } from "@/lib/api";
import { AreaChart, Panel, Stat, StatusPill, useFormat } from "@/features/oneknight/ui/kit";
import { MyLeads } from "./Leads";
import { siteState, type SiteInfo } from "./SiteScreen";

type Insight = { id: string; tone: "bad" | "warn" | "good"; key: string; params: Record<string, string | number>; action?: string };
type Dash = {
  orders: { today: number; newCount: number; revenue30: number; orders30: number };
  latest: { id: string; number: number; customerName: string; totalKop: number; status: "new" | "confirmed" | "paid" | "shipped" | "done" | "cancelled"; createdAt: string }[];
  traffic: { visitors30: number; series: { date: string; sessions: number; orders: number }[] } | null;
  sites: SiteInfo[];
  insights: Insight[];
};

function InsightCard({ i, go, onDone }: { i: Insight; go: (s: string) => void; onDone: () => void }) {
  const d = useDict().app;
  const [open, setOpen] = useState(false);
  const copy = (d.insights as Record<string, { title: string; why: string; todo: string }>)[i.key];
  if (!copy) return null;
  const params = { ...i.params, ...(i.params.channel ? { channel: (d.analytics.channels as Record<string, string>)[String(i.params.channel)] ?? String(i.params.channel).replace(/^other:/, "") } : {}) };
  return (
    <article className="ok-rec" data-tone={i.tone === "bad" ? "warn" : i.tone}>
      <button type="button" className="ok-rec-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={i.tone === "good" ? "chart" : "bolt"} size={18} />
        <span>{fmt(copy.title, params)}</span>
        <small>{open ? d.dash.hide : d.dash.details}</small>
      </button>
      {open && (
        <div className="ok-rec-body">
          <p><b>{d.dash.why}.</b> {fmt(copy.why, params)}</p>
          <p><b>{d.dash.todo}.</b> {fmt(copy.todo, params)}</p>
          <div className="ok-actions">
            {i.action && <button type="button" className="btn btn-sm btn-secondary" onClick={() => go(i.action!)}>{d.dash.open}</button>}
            <button type="button" className="btn btn-sm" onClick={async () => { await api("/dashboard/insights/dismiss", { method: "POST", body: { id: i.id } }); onDone(); }}><Icon name="check" size={15} />{d.dash.done}</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function HomeScreen({ me, go }: { me: Me; go: (s: string) => void }) {
  const d = useDict();
  const t = d.app;
  const lang = useLang();
  const f = useFormat();
  const [data, setData] = useState<Dash | null>(null);
  const load = useCallback(async () => {
    const r = await api<Dash>("/dashboard");
    if (r.ok) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);
  const money = (k: number) => formatUAH(k / 100, lang);
  const site = data?.sites[0];
  const st = site ? siteState(site) : null;
  const attention = data?.insights.filter((i) => i.tone !== "good") ?? [];
  const good = data?.insights.filter((i) => i.tone === "good") ?? [];
  const conv = data?.traffic && data.traffic.visitors30 ? data.orders.orders30 / data.traffic.visitors30 : null;

  return (
    <div className="ok-screen">
      <div className="ok-hello">
        <h3>{fmt(t.home.hello, { name: me.name })}</h3>
        <p>{t.home.lead}</p>
      </div>
      {data && (
        <div className="ok-stats ok-home-stats">
          <Stat label={t.site.title} icon="globe" value={site && st ? t.site[st.key] : "—"} tone={st?.tone} sub={site?.domain} />
          <Stat label={t.dash.today} icon="cart" value={f.num(data.orders.today)} sub={data.orders.newCount ? fmt(t.dash.waiting, { n: data.orders.newCount }) : undefined} />
          <Stat label={t.dash.revenue} icon="card" value={money(data.orders.revenue30)} />
          <Stat label={t.dash.visitors} icon="eye" value={data.traffic ? f.num(data.traffic.visitors30) : "—"} sub={data.traffic ? undefined : t.dash.noAnalytics} />
          <Stat label={t.dash.conversion} icon="chart" value={conv === null ? "—" : f.pct(conv)} />
        </div>
      )}
      {data && (
        <div className="ok-grid-2 ok-home-bottom">
          <Panel title={t.dash.attention} className="ok-problems">
            {attention.length ? (
              <div className="ok-recs">{attention.map((i) => <InsightCard key={i.id} i={i} go={go} onDone={load} />)}</div>
            ) : (
              <p className="ok-muted"><Icon name="check" size={15} /> {t.dash.allGood}</p>
            )}
          </Panel>
          <Panel title={t.dash.latest} action={<button type="button" className="ok-link" onClick={() => go("orders")}>{t.dash.all}</button>}>
            {data.latest.length ? (
              <ul className="ok-list">
                {data.latest.map((o) => (
                  <li key={o.id}>
                    <span className="num ok-muted">#{o.number}</span>
                    <span className="ok-grow">{o.customerName}</span>
                    <span className="num">{money(o.totalKop)}</span>
                    <StatusPill status={o.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ok-muted">{t.dash.noOrders}</p>
            )}
          </Panel>
        </div>
      )}
      {data?.traffic && (
        <div className="ok-grid-2">
          <Panel title={t.dash.chart}>
            <AreaChart a={data.traffic.series.map((s) => s.sessions)} b={data.traffic.series.map((s) => s.orders)} labelA={t.analytics.visits} labelB={t.analytics.orders} />
          </Panel>
          <Panel title={t.dash.recs}>
            {good.length ? <div className="ok-recs">{good.map((i) => <InsightCard key={i.id} i={i} go={go} onDone={load} />)}</div> : <p className="ok-muted">—</p>}
          </Panel>
        </div>
      )}
      <MyLeads />
    </div>
  );
}
