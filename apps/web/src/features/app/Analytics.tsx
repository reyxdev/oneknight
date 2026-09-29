"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt, plural } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { AreaChart, Panel, Stat, useFormat } from "@/features/oneknight/ui/kit";
import { useBilling } from "./Billing";
import { useSites } from "./SiteScreen";

type Data = {
  totals: { sessions: number; pageviews: number; leads: number; orders: number; revenueKop: number | null; conversion: number } | null;
  series: { date: string; sessions: number; orders: number }[];
  sources: { channel: string; campaign: string | null; sessions: number; leads: number; orders: number; revenueKop: number | null; source: string | null; medium: string | null }[];
};

export function AnalyticsScreen({ goModules }: { goModules: () => void }) {
  const d = useDict();
  const t = d.app.analytics;
  const lang = useLang();
  const f = useFormat();
  const { data: billing } = useBilling();
  const { sites } = useSites();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [data, setData] = useState<Data | null>(null);
  const [raw, setRaw] = useState(false);
  const active = !!billing?.modules.some((m) => m.id === "analytics");
  const load = useCallback(async () => {
    const r = await api<Data>(`/analytics?days=${days}`);
    if (r.ok) setData(r.data);
  }, [days]);
  useEffect(() => {
    if (active) void load();
  }, [load, active]);

  if (!billing) return null;
  if (!active)
    return (
      <div className="ok-screen">
        <div className="ok-h"><h3>{t.title}</h3></div>
        <Panel>
          <p className="ok-muted">{t.needModule}</p>
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={goModules}><Icon name="puzzle" size={15} />{d.app.reviews.toModules}</button>
        </Panel>
      </div>
    );
  const key = sites?.[0]?.publicKey ?? "sk_…";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oneknight.pro";
  const channel = (c: string) => (t.channels as Record<string, string>)[c] ?? c.replace(/^other:/, "");
  const tot = data?.totals;
  const hasData = !!tot && tot.sessions > 0;
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        <Segmented label={t.period} value={days} onChange={setDays} options={[{ v: "7", t: t.d7 }, { v: "30", t: t.d30 }, { v: "90", t: t.d90 }]} />
      </div>
      {hasData && tot && (
        <>
          <div className="ok-stats">
            <Stat label={t.visits} icon="eye" value={f.num(tot.sessions)} />
            <Stat label={t.leads} icon="chat" value={f.num(tot.leads)} />
            <Stat label={t.orders} icon="cart" value={f.num(tot.orders)} />
            {tot.revenueKop !== null && <Stat label={t.revenue} icon="card" value={<span className="app-secret">{formatUAH(tot.revenueKop / 100, lang)}</span>} />}
            <Stat label={t.conversion} icon="chart" value={f.pct(tot.conversion)} />
          </div>
          <Panel title={t.chart}>
            <AreaChart key={days} a={data!.series.map((s) => s.sessions)} b={data!.series.map((s) => s.orders)} labelA={t.visits} labelB={t.orders} height={200} />
          </Panel>
          <Panel title={t.sources} action={<button type="button" className="ok-link" aria-pressed={raw} onClick={() => setRaw((v) => !v)}>{raw ? t.hideRaw : t.raw}</button>}>
            <ul className="ok-sources">
              {data!.sources.map((s) => {
                const max = Math.max(...data!.sources.map((x) => x.sessions));
                return (
                  <li key={`${s.channel}-${s.campaign}`}>
                    <div className="ok-src-bar"><i style={{ ["--w" as string]: s.sessions / max }} /></div>
                    <p>{fmt(t.path, { channel: channel(s.channel), campaign: s.campaign ? ` → ${s.campaign}` : "", visits: `${f.num(s.sessions)} ${plural(lang, s.sessions, t.words.visits)}`, leads: `${f.num(s.leads)} ${plural(lang, s.leads, t.words.leads)}`, orders: `${f.num(s.orders)} ${plural(lang, s.orders, t.words.orders)}` })}{s.revenueKop ? ` · ${formatUAH(s.revenueKop / 100, lang)}` : ""}</p>
                    {raw && <code>{s.source ? `utm_source=${s.source}` : "(no utm)"}{s.medium ? `&utm_medium=${s.medium}` : ""}{s.campaign ? `&utm_campaign=${s.campaign}` : ""}</code>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      )}
      {data && !hasData && <Panel><p className="ok-muted">{t.empty}</p></Panel>}
      <Panel title={t.install}>
        <p className="ok-muted">{t.step1}</p>
        <pre className="app-code-block">{`<script src="${origin}/ok.js" data-key="${key}" defer></script>`}</pre>
        <p className="ok-muted">{t.step2}</p>
        <pre className="app-code-block">{"oneknight.track()"}</pre>
        <p className="ok-muted">{t.step3}</p>
        <pre className="app-code-block">{`{ ...order, analytics: oneknight.context() }`}</pre>
        <p className="ok-muted"><Icon name="shield" size={14} /> {t.privacy}</p>
      </Panel>
    </div>
  );
}
