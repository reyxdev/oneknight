"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Segmented } from "@/components/ui/Toggle";
import { useOkState } from "../state";
import { AreaChart, Panel, Stat, useFormat } from "../ui/kit";

export function Analytics() {
  const t = useDict().ok.analytics;
  const s = useOkState();
  const f = useFormat();
  const [period, setPeriod] = useState<"7" | "30">("30");
  const [raw, setRaw] = useState(false);
  const series = period === "7" ? s.analytics.series.slice(-7) : s.analytics.series;
  const visits = series.reduce((a, d) => a + d.visits, 0);
  const orders = series.reduce((a, d) => a + d.orders, 0);
  const max = Math.max(...s.analytics.sources.map((x) => x.visits));
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        <Segmented label={t.period} value={period} onChange={setPeriod} options={[{ v: "7", t: t.d7 }, { v: "30", t: t.d30 }]} />
      </div>
      <div className="ok-stats">
        <Stat label={t.visits} icon="eye" value={f.num(visits)} />
        <Stat label={t.orders} icon="cart" value={f.num(orders)} />
        <Stat label={t.conv} icon="chart" value={f.pct(orders / visits)} />
      </div>
      <Panel>
        <AreaChart key={period} a={series.map((d) => d.visits)} b={series.map((d) => d.orders)} labelA={t.visits} labelB={t.orders} height={200} />
      </Panel>
      <Panel title={t.sources} action={<button type="button" className="ok-link" aria-pressed={raw} onClick={() => setRaw((v) => !v)}>{raw ? t.hideRaw : t.raw}</button>}>
        <ul className="ok-sources">
          {s.analytics.sources.map((x) => (
            <li key={x.id}>
              <div className="ok-src-bar"><i style={{ ["--w" as string]: x.visits / max }} /></div>
              <p>
                {x.channel === "direct"
                  ? `${t.direct} → ${x.visits} → ${x.leads} → ${x.sales}`
                  : fmt(t.path, { channel: x.channel, campaign: t.campaigns[x.campaign as keyof typeof t.campaigns] ?? x.campaign, visits: x.visits, leads: x.leads, sales: x.sales })}
              </p>
              {raw && <code>{x.channel === "direct" ? "(direct) / (none)" : `utm_source=${x.id}&utm_campaign=${x.campaign.toLowerCase().replace(/\s+/g, "")}`}</code>}
            </li>
          ))}
        </ul>
      </Panel>
      <p className="ok-muted">{t.googleNote}</p>
    </div>
  );
}
