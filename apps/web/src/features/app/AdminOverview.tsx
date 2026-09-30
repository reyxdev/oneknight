"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { Panel, Stat, useFormat } from "@/features/oneknight/ui/kit";

type Overview = {
  todo: { key: string; n: number; screen: string; list?: string[] }[];
  numbers: { chargedKop: number; chargedPrevKop: number; monthlyKop: number; paying: number; registrations: number; registrationsPrev: number; byStatus: Record<string, number>; converted: number; churned: number };
  funnel: Record<string, number>;
  modules: { id: string; n: number }[];
  risk: { id: string; name: string; owner: string; phone: string; status: string; lastSeen: string | null; reasons: string[] }[];
};

/** «Огляд» of the admin: first what needs Ivan, then the numbers, «Ризик відтоку», the lead funnel, modules. */
export function AdminOverview({ go }: { go: (screen: string, tab?: string) => void }) {
  const d = useDict();
  const t = d.app.adminOverview;
  const lang = useLang();
  const f = useFormat();
  const [o, setO] = useState<Overview | null>(null);
  const load = useCallback(async () => {
    const r = await api<Overview>("/admin/overview");
    if (r.ok) setO(r.data);
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);
  if (!o) return null;
  const n = o.numbers;
  const money = (kop: number) => formatUAH(kop / 100, lang);
  const delta = (cur: number, prev: number) => (prev ? fmt(t.vsPrev, { v: `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%` }) : undefined);
  const funnelMax = Math.max(1, ...Object.values(o.funnel));
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.todoTitle}>
        {o.todo.length === 0 ? (
          <p className="ok-muted">{t.todoEmpty}</p>
        ) : (
          <ul className="ok-todos">
            {o.todo.map((x) => (
              <li key={x.key} data-tone={x.key === "leadsLate" || x.key === "sitesDown" ? "bad" : "warn"}>
                <button type="button" className="ok-todos-main" onClick={() => go(x.screen)}>
                  <Icon name="bell" size={16} />
                  <span>{fmt((t.todo as Record<string, string>)[x.key] ?? x.key, { n: x.n })}{x.list?.length ? `: ${x.list.slice(0, 3).join(", ")}${x.list.length > 3 ? "…" : ""}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="ok-stats">
        <Stat label={t.charged} icon="card" value={<span className="app-secret">{money(n.chargedKop)}</span>} sub={delta(n.chargedKop, n.chargedPrevKop)} />
        <Stat label={t.monthly} icon="refresh" value={<span className="app-secret">{money(n.monthlyKop)}</span>} sub={fmt(t.paying, { n: n.paying })} />
        <Stat label={t.registrations} icon="person" value={n.registrations} sub={delta(n.registrations, n.registrationsPrev)} />
        <Stat label={t.converted} icon="check" value={n.converted} sub={fmt(t.onTrial, { n: n.byStatus.trial ?? 0 })} />
        <Stat label={t.churned} icon="clock" value={n.churned} tone={n.churned ? "warn" : undefined} sub={fmt(t.inGrace, { n: n.byStatus.grace ?? 0 })} />
      </div>
      <Panel title={fmt(t.riskTitle, { n: o.risk.length })}>
        {o.risk.length === 0 ? (
          <p className="ok-muted">{t.riskEmpty}</p>
        ) : (
          <ul className="ok-list">
            {o.risk.map((r) => (
              <li key={r.id}>
                <span className="ok-grow">
                  <b>{r.name}</b>
                  <small>{r.owner} · <a className="ok-link" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>{r.lastSeen ? ` · ${fmt(t.lastSeen, { ago: f.ago(new Date(r.lastSeen).getTime()) })}` : ""}</small>
                </span>
                <span className="app-risk">{r.reasons.map((x) => <span key={x} className="ok-pill" data-s={x === "payment" || x === "grace" ? "cancelled" : "shipped"}>{(t.reasons as Record<string, string>)[x] ?? x}</span>)}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => go("clients", `c-${r.id}`)}>{t.open}</button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="app-two">
        <Panel title={t.funnelTitle}>
          <ul className="ok-sources">
            {(["new", "contacted", "proposal", "prepaid", "in_work", "done", "lost"] as const).filter((s) => s in d.app.leads.status).map((s) => (
              <li key={s}>
                <div className="ok-src-bar"><i style={{ ["--w" as string]: (o.funnel[s] ?? 0) / funnelMax }} /></div>
                <p>{(d.app.leads.status as Record<string, string>)[s]}: <b className="num">{o.funnel[s] ?? 0}</b></p>
              </li>
            ))}
          </ul>
          <p className="ok-muted">{t.funnelHint}</p>
        </Panel>
        <Panel title={t.modulesTitle}>
          {o.modules.length === 0 ? (
            <p className="ok-muted">{t.modulesEmpty}</p>
          ) : (
            <ul className="ok-list">
              {o.modules.map((m) => (
                <li key={m.id}>
                  <span className="ok-grow">{(d.ok.modules.items as Record<string, { name?: string }>)[m.id]?.name ?? m.id}</span>
                  <b className="num">{m.n}</b>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
