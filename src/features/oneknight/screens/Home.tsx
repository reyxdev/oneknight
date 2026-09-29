"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { useClient, useOkState } from "../state";
import { AreaChart, Panel, Stat, StatusPill, useFormat } from "../ui/kit";
import type { ScreenId } from "../ui/Shell";
import type { Recommendation } from "../domain";

const DAY = 86_400_000;

export function Home({ go }: { go: (s: ScreenId) => void }) {
  const dict = useDict();
  const t = dict.ok;
  const s = useOkState();
  const f = useFormat();
  const site = s.sites.find((x) => x.id === s.activeSiteId)!;
  const today = s.orders.filter((o) => Date.now() - o.createdAt < DAY && o.status !== "cancelled");
  const sales = s.orders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + o.total, 0);
  const visits = s.analytics.series.reduce((a, d) => a + d.visits, 0);
  const orders30 = s.analytics.series.reduce((a, d) => a + d.orders, 0);
  const speed = s.checks.find((c) => c.id === "speed");
  const problems = [
    ...s.products.filter((p) => p.stock === 0).map((p) => ({ k: `o${p.id}`, text: fmt(t.home.outStock, { name: p.name }), go: "products" as const })),
    ...s.products.filter((p) => p.stock > 0 && p.stock <= 2).map((p) => ({ k: `l${p.id}`, text: fmt(t.home.lowStock, { name: p.name, n: p.stock }), go: "products" as const })),
    ...(s.reviews.some((r) => r.status === "pending") ? [{ k: "rv", text: fmt(t.home.pendingReviews, { n: s.reviews.filter((r) => r.status === "pending").length }), go: "reviews" as const }] : []),
    ...(speed?.state === "warn" ? [{ k: "sp", text: fmt(t.home.slowSite, { s: speed.value }), go: "site" as const }] : []),
  ];

  return (
    <div className="ok-screen">
      <div className="ok-hello">
        <h3>{fmt(t.home.hello, { name: s.userName })}</h3>
        <p>{fmt(t.home.summary, { orders: today.filter((o) => o.status === "new").length })}</p>
      </div>
      <div className="ok-stats ok-home-stats">
        <Stat label={t.home.siteStatus} icon="globe" value={site.status === "up" ? t.home.up : t.home.down} sub={site.domain} tone={site.status === "up" ? "ok" : "bad"} />
        <Stat label={t.home.todayOrders} icon="cart" value={today.length} />
        <Stat label={t.home.sales} icon="card" value={f.money(sales)} />
        <Stat label={t.home.visitors} icon="eye" value={f.num(visits)} />
        <Stat label={t.home.conversion} icon="chart" value={f.pct(orders30 / visits)} />
      </div>
      <div className="ok-grid-2">
        <Panel title={t.home.chart}>
          <AreaChart a={s.analytics.series.map((d) => d.visits)} b={s.analytics.series.map((d) => d.orders)} labelA={t.analytics.visits} labelB={t.analytics.orders} />
        </Panel>
        <Panel title={t.home.recs}>
          <div className="ok-recs">
            {s.recommendations.map((r) => (
              <Rec key={r.id} r={r} />
            ))}
          </div>
        </Panel>
      </div>
      <div className="ok-grid-2 ok-home-bottom">
        <Panel title={t.home.latest} action={<button type="button" className="ok-link" onClick={() => go("orders")}>{t.home.all}</button>}>
          <ul className="ok-list">
            {s.orders.slice(0, 4).map((o) => (
              <li key={o.id}>
                <span className="num ok-muted">#{o.number}</span>
                <span className="ok-grow">{o.customer}</span>
                <span className="num">{f.money(o.total)}</span>
                <StatusPill status={o.status} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="ok-problems" title={<><span className="ok-d-only">{t.home.problems}</span><span className="ok-m-only">{dict.ok.mobile.now}</span></>}>
          {problems.length ? (
            <ul className="ok-list">
              {problems.map((p) => (
                <li key={p.k}>
                  <Icon name="bolt" size={16} className="ok-warn" />
                  <span className="ok-grow">{p.text}</span>
                  <button type="button" className="ok-link" onClick={() => go(p.go)} aria-label={t.nav[p.go]}>
                    <Icon name="arrow" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ok-muted">{t.home.noProblems}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Rec({ r }: { r: Recommendation }) {
  const t = useDict().ok.rec;
  const client = useClient();
  const [open, setOpen] = useState(false);
  const c = t[r.key];
  return (
    <article className="ok-rec" data-tone={r.tone} data-done={r.done}>
      <button type="button" className="ok-rec-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={r.tone === "warn" ? "bolt" : "chart"} size={18} />
        <span>{fmt(c.title, { v: r.value })}</span>
        <small>{r.done ? t.doneLabel : open ? t.hide : t.details}</small>
      </button>
      {open && (
        <div className="ok-rec-body">
          <p><b>{t.explain}.</b> {c.why}</p>
          <p><b>{t.action}.</b> {c.todo}</p>
          {!r.done && (
            <button type="button" className="btn btn-sm" data-sound="success" onClick={() => client.completeRecommendation(r.id)}>
              <Icon name="check" size={16} />
              {t.done}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
