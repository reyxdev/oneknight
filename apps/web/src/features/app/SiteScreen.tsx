"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { AreaChart, Panel, Stat, useFormat } from "@/features/oneknight/ui/kit";

export type SiteInfo = {
  id: string;
  domain: string;
  name: string;
  status: "building" | "live" | "paused";
  checks30d: number;
  uptime30d: number | null;
  avgMs24h: number | null;
  last: { at: string; up: boolean; statusCode: number | null; responseMs: number | null; error: string | null } | null;
  sslDaysLeft: number | null;
};

export function useSites() {
  const [sites, setSites] = useState<SiteInfo[] | null>(null);
  const [error, setError] = useState(false);
  const load = async () => {
    const r = await api<SiteInfo[]>("/sites");
    setError(!r.ok);
    if (r.ok) setSites(r.data);
  };
  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  return { sites, error, load };
}

export function siteState(s: SiteInfo): { tone: "ok" | "bad" | "warn" | undefined; key: "up" | "down" | "unknown" | "building" | "paused" } {
  if (s.status === "building") return { tone: undefined, key: "building" };
  if (s.status === "paused") return { tone: "warn", key: "paused" };
  if (!s.last) return { tone: undefined, key: "unknown" };
  return s.last.up ? { tone: "ok", key: "up" } : { tone: "bad", key: "down" };
}

function SiteCard({ s }: { s: SiteInfo }) {
  const t = useDict().app.site;
  const f = useFormat();
  const [series, setSeries] = useState<number[] | null>(null);
  useEffect(() => {
    void api<{ at: string; up: boolean; ms: number | null }[]>(`/sites/${s.id}/checks?hours=24`).then((r) => {
      if (r.ok) setSeries(r.data.slice().reverse().map((c) => (c.up && c.ms ? c.ms : 0)));
    });
  }, [s.id, s.last?.at]);
  const st = siteState(s);
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{s.name}</h3>
        <a className="btn btn-sm btn-secondary" href={`https://${s.domain}`} target="_blank" rel="noopener">{s.domain}<Icon name="arrow" size={15} /></a>
      </div>
      <div className="ok-stats">
        <Stat label={t.title} icon="globe" value={t[st.key]} tone={st.tone} sub={s.last ? `${t.lastCheck}: ${f.ago(new Date(s.last.at).getTime())}` : undefined} />
        <Stat label={t.uptime} icon="shield" value={s.uptime30d === null ? "—" : f.pct(s.uptime30d)} sub={s.checks30d ? fmt(t.checks, { n: s.checks30d }) : undefined} />
        <Stat label={t.speed} icon="bolt" value={s.avgMs24h === null ? "—" : fmt(t.ms, { n: f.num(s.avgMs24h) })} />
        <Stat label={t.ssl} icon="lock" value={s.sslDaysLeft === null ? "—" : fmt(t.sslDays, { n: s.sslDaysLeft })} tone={s.sslDaysLeft !== null && s.sslDaysLeft <= 14 ? "bad" : undefined} />
      </div>
      {s.last && !s.last.up && s.last.error && <p className="ok-alert" role="status"><Icon name="bolt" size={18} />{fmt(t.error, { e: s.last.error })}</p>}
      <Panel title={t.chart}>
        {series && series.length > 1 ? <AreaChart a={series} labelA={t.chart} /> : <p className="ok-muted">{t.noData}</p>}
      </Panel>
      <p className="ok-muted">{t.how}</p>
    </div>
  );
}

export function SiteScreen() {
  const d = useDict();
  const t = d.app.site;
  const { sites, error, load } = useSites();
  const [sel, setSel] = useState(0);
  if (error) return <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>;
  if (!sites) return null;
  if (!sites.length)
    return (
      <div className="ok-screen">
        <div className="ok-h"><h3>{t.title}</h3></div>
        <Panel><p className="ok-muted">{t.empty}</p></Panel>
      </div>
    );
  const cur = sites[Math.min(sel, sites.length - 1)]!;
  return (
    <>
      {sites.length > 1 && (
        <div className="ok-chips" role="tablist" aria-label={t.title} style={{ marginBottom: "1rem" }}>
          {sites.map((s, i) => (
            <button key={s.id} type="button" role="tab" className="ok-chip" aria-selected={i === sel} aria-pressed={i === sel} onClick={() => setSel(i)}>{s.domain}</button>
          ))}
        </div>
      )}
      <SiteCard s={cur} key={cur.id} />
    </>
  );
}
