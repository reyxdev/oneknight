"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { api, latestOnly, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { AreaChart, Panel, Stat, StatusPill, useFlash, useFormat } from "@/features/oneknight/ui/kit";
import { MyLeads } from "./Leads";

type Go = (screen: string, tab?: string) => void;
type Period = "today" | "7" | "30" | "90";
const PERIODS: Period[] = ["today", "7", "30", "90"];
const PERIOD_KEY = "ok.home.period";
/** Sums are null without «Фінанси». */
type Sales = { revenueKop: number | null; orders: number; cancelled: number };
type Visits = { sessions: number; orders: number };
type Todo = { id: string; key: string; tone: "bad" | "warn"; params: Record<string, string | number>; screen: string; tab?: string };
type Insight = { id: string; tone: "bad" | "warn" | "good"; key: string; params: Record<string, string | number>; action?: string };
type Step = "site" | "okjs" | "products" | "subscription" | "twofa" | "telegram";
const STEPS: { id: Step; screen: string; tab?: string }[] = [
  { id: "site", screen: "site" },
  { id: "okjs", screen: "site" },
  { id: "products", screen: "products", tab: "new" },
  { id: "subscription", screen: "billing" },
  { id: "twofa", screen: "profile", tab: "security" },
  { id: "telegram", screen: "profile", tab: "notifications" },
];
type Dash = {
  period: Period;
  sales: { cur: Sales; prev: Sales; series: { label: string; revenueKop: number | null; orders: number }[] } | null;
  traffic: { cur: Visits; prev: Visits } | null;
  goal: { goalKop: number | null; monthKop: number; forecastKop: number | null; canEdit: boolean } | null;
  ship: { list: { id: string; number: number; customerName: string; totalKop: number | null; status: "confirmed" | "paid"; waybill: string | null; method: string }[]; printable: number } | null;
  todo: Todo[];
  steps: Record<Step, boolean> | null;
  reviews: { id: string; authorName: string; rating: number; text: string; status: string; createdAt: string }[] | null;
  tips: Insight[];
};

const readPeriod = (): Period => {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    return (PERIODS as string[]).includes(v ?? "") ? (v as Period) : "7";
  } catch {
    return "7";
  }
};

/** "+12% до попереднього"; shares (`points`) compare in percentage points; `lowerIsBetter` flips the colour. */
function Delta({ cur, prev, lowerIsBetter = false, points = false }: { cur: number; prev: number; lowerIsBetter?: boolean; points?: boolean }) {
  const t = useDict().app.home;
  const f = useFormat();
  if (points) {
    if (cur === prev) return null;
    const pp = Math.round((cur - prev) * 1000) / 10;
    return <span className="ok-delta" data-good={lowerIsBetter ? pp < 0 : pp > 0}>{fmt(t.vsPoints, { v: `${pp > 0 ? "+" : ""}${f.num(pp)}` })}</span>;
  }
  if (prev === 0) return cur > 0 ? <span className="ok-delta">{t.vsNew}</span> : null;
  const v = Math.round(((cur - prev) / prev) * 100);
  const good = lowerIsBetter ? v <= 0 : v >= 0;
  return <span className="ok-delta" data-good={v === 0 ? undefined : good}>{fmt(t.vs, { v: `${v > 0 ? "+" : ""}${v}%` })}</span>;
}

function TipCard({ i, go, onDone }: { i: Insight; go: Go; onDone: () => void }) {
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

function FirstSteps({ steps, go, onDone }: { steps: Record<Step, boolean>; go: Go; onDone: (text: string) => void }) {
  const t = useDict().app.home;
  const [busy, setBusy] = useState(false);
  const n = STEPS.filter((s) => steps[s.id]).length;
  const all = n === STEPS.length;
  const claim = async () => {
    setBusy(true);
    const r = await api<{ until: string }>("/dashboard/first-steps/claim", { method: "POST" });
    setBusy(false);
    if (r.ok) {
      playSound("success");
      onDone(t.stepsRewarded);
    }
  };
  return (
    <Panel title={t.stepsTitle} className="ok-steps" action={<span className="ok-muted num">{fmt(t.stepsProgress, { n, total: STEPS.length })}</span>}>
      <p className="ok-muted">{t.stepsLead}</p>
      <div className="ok-bar" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={n} aria-label={t.stepsTitle}><i style={{ width: `${(n / STEPS.length) * 100}%` }} /></div>
      <ol className="ok-steps-list">
        {STEPS.map((s, i) => (
          <li key={s.id} data-done={steps[s.id]}>
            <span className="ok-step-mark">{steps[s.id] ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="ok-grow">
              <b>{t.steps[s.id].title}</b>
              <small>{t.steps[s.id].text}</small>
            </span>
            {!steps[s.id] && <button type="button" className="btn btn-sm btn-secondary" onClick={() => go(s.screen, s.tab)}>{t.steps[s.id].cta}</button>}
          </li>
        ))}
      </ol>
      {all && <button type="button" className="btn btn-sm" disabled={busy} onClick={claim}><Icon name="check" size={15} />{t.stepsClaim}</button>}
    </Panel>
  );
}

function Goal({ g, onSaved }: { g: NonNullable<Dash["goal"]>; onSaved: () => void }) {
  const t = useDict().app.home;
  const f = useFormat();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(g.goalKop ? String(g.goalKop / 100) : "");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(v.replace(/\s/g, "")));
    const r = await api("/dashboard/goal", { method: "PATCH", body: { goalUah: v.trim() === "" ? null : n } });
    if (r.ok) {
      setEditing(false);
      onSaved();
    }
  };
  const form = (
    <form className="ok-goal-form" onSubmit={save}>
      <label className="sr-only" htmlFor="ok-goal">{t.goalLabel}</label>
      <input id="ok-goal" className="input" inputMode="numeric" placeholder={t.goalPlaceholder} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d\s]/g, ""))} />
      <button className="btn btn-sm" type="submit" disabled={v.trim() !== "" && !(Number(v.replace(/\s/g, "")) >= 1)}>{t.goalSave}</button>
      {g.goalKop !== null && <button className="btn btn-sm btn-secondary" type="button" onClick={() => setEditing(false)}>{t.cancel}</button>}
    </form>
  );
  if (g.goalKop === null)
    return (
      <Panel title={t.goalTitle}>
        <p className="ok-muted app-secret">{fmt(t.goalMonth, { sum: f.money(g.monthKop / 100) })}</p>
        {g.canEdit ? form : <p className="ok-muted">{t.goalNone}</p>}
      </Panel>
    );
  const done = g.monthKop / g.goalKop;
  const forecast = g.forecastKop === null ? null : g.forecastKop / g.goalKop;
  return (
    <Panel title={t.goalTitle} action={g.canEdit && !editing ? <button type="button" className="ok-link" onClick={() => setEditing(true)}>{t.goalChange}</button> : undefined}>
      <p className="ok-goal-line">
        <b className="num">{fmt(t.goalDone, { v: Math.round(done * 100) })}</b>
        {forecast !== null && <span className="ok-muted">{fmt(t.goalForecast, { v: Math.round(forecast * 100) })}</span>}
      </p>
      <div className="ok-bar" data-full={done >= 1} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(done * 100))} aria-label={t.goalTitle}><i style={{ width: `${Math.min(100, done * 100)}%` }} /></div>
      <p className="ok-muted num app-secret">{f.money(g.monthKop / 100)} / {f.money(g.goalKop / 100)}</p>
      {done >= 1 && <p className="ok-goal-win"><Icon name="check" size={15} /> {t.goalReached}</p>}
      {editing && form}
    </Panel>
  );
}

function ShipToday({ ship, go, notify }: { ship: NonNullable<Dash["ship"]>; go: Go; notify: (text: string, tone?: "ok" | "warn") => void }) {
  const d = useDict();
  const t = d.app.home;
  const lang = useLang();
  const print = async (kind: "document" | "marking") => {
    // The tab opens right away (a click), then gets the merged PDF: browsers block pop-ups opened later.
    const w = window.open("", "_blank");
    const res = await fetch(`/api/integrations/print-ready?kind=${kind}`, { credentials: "same-origin" }).catch(() => null);
    if (!res?.ok) {
      w?.close();
      return notify(t.printFailed, "warn");
    }
    const failed = res.headers.get("x-failed-orders");
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url;
    else location.href = url;
    if (failed) notify(fmt(t.printPartly, { list: failed.split(",").map((n) => `№${n}`).join(", ") }), "warn");
  };
  return (
    <Panel title={t.shipTitle} action={ship.list.length ? <span className="ok-muted num">{ship.list.length}</span> : undefined}>
      {ship.list.length === 0 ? (
        <p className="ok-muted"><Icon name="check" size={15} /> {t.shipEmpty}</p>
      ) : (
        <>
          <ul className="ok-rows ok-ship">
            {ship.list.slice(0, 8).map((o) => (
              <li key={o.id}>
                <button type="button" className="ok-row" onClick={() => go("orders", `o-${o.id}`)}>
                  <span className="num ok-muted">#{o.number}</span>
                  <span className="ok-grow"><b>{o.customerName}</b><small>{(d.app.orders.methods as Record<string, string>)[o.method] ?? o.method}{o.waybill ? ` · ${o.waybill}` : ""}</small></span>
                  {o.totalKop !== null && <span className="num app-secret">{formatUAH(o.totalKop / 100, lang)}</span>}
                  {o.waybill ? <StatusPill status={o.status} /> : <span className="ok-pill" data-s="new">{t.noWaybill}</span>}
                </button>
              </li>
            ))}
          </ul>
          {ship.list.length > 8 && <button type="button" className="ok-link" onClick={() => go("orders", "confirmed")}>{fmt(t.showAll, { n: ship.list.length })}</button>}
          {ship.printable > 0 && (
            <div className="ok-actions">
              <button type="button" className="btn btn-sm" onClick={() => print("document")}><Icon name="doc" size={15} />{fmt(t.printAll, { n: ship.printable })}</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => print("marking")}>{t.printLabels}</button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function TodoList({ todo, go, onChange }: { todo: Todo[]; go: Go; onChange: () => void }) {
  const t = useDict().app.home;
  const [all, setAll] = useState(false);
  const shown = all ? todo : todo.slice(0, 5);
  const snooze = async (id: string) => {
    await api("/dashboard/insights/dismiss", { method: "POST", body: { id, days: 1 } });
    onChange();
  };
  return (
    <Panel title={t.todoTitle} action={todo.length ? <span className="ok-muted num">{todo.length}</span> : undefined}>
      {todo.length === 0 ? (
        <p className="ok-muted"><Icon name="check" size={15} /> {t.todoEmpty}</p>
      ) : (
        <ul className="ok-todos">
          {shown.map((i) => (
            <li key={i.id} data-tone={i.tone}>
              <button type="button" className="ok-todos-main" onClick={() => go(i.screen, i.tab)}>
                <Icon name={i.tone === "bad" ? "bolt" : "bell"} size={16} />
                <span>{fmt((t.todo as Record<string, string>)[i.key] ?? i.key, i.params)}</span>
              </button>
              <button type="button" className="ok-link" onClick={() => snooze(i.id)}>{t.snooze}</button>
            </li>
          ))}
        </ul>
      )}
      {todo.length > 5 && <button type="button" className="ok-link" onClick={() => setAll((v) => !v)}>{all ? t.showLess : fmt(t.showAll, { n: todo.length })}</button>}
    </Panel>
  );
}

export function HomeScreen({ me, go }: { me: Me; go: Go }) {
  const d = useDict();
  const t = d.app;
  const h = t.home;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [period, setPeriod] = useState<Period>(readPeriod);
  const [data, setData] = useState<Dash | null>(null);
  const [next] = useState(latestOnly);
  const load = useCallback(async () => {
    const isLatest = next();
    const r = await api<Dash>(`/dashboard?period=${period}`);
    if (r.ok && isLatest()) setData(r.data);
  }, [period, next]);
  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);
  const pick = (p: Period) => {
    setPeriod(p);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {}
  };
  const money = (k: number) => f.money(k / 100);
  const s = data?.sales;
  const v = data?.traffic;
  const conv = (x: Visits | undefined) => (x && x.sessions ? x.orders / x.sessions : null);
  const cancelRate = (x: Sales) => (x.orders + x.cancelled ? x.cancelled / (x.orders + x.cancelled) : 0);
  const canProducts = me.permissions.includes("products");
  const canAnalytics = me.permissions.includes("analytics");
  const withMoney = s?.cur.revenueKop !== null;
  const series = s?.series ?? [];
  const axis = (l: string) => (period === "today" ? `${l}:00` : f.date(new Date(`${l}T12:00:00`).getTime()));

  return (
    <div className="ok-screen">
      <div className="ok-hello ok-home-head">
        <div>
          <h3>{fmt(h.hello, { name: me.name })}</h3>
          <p>{h.lead}</p>
        </div>
        <div className="ok-actions">
          {canProducts && <button type="button" className="btn btn-sm btn-secondary" onClick={() => go("products", "new")}><Icon name="plus" size={15} />{h.addProduct}</button>}
        </div>
      </div>

      {data?.steps && <FirstSteps steps={data.steps} go={go} onDone={(text) => { show(text); void load(); }} />}

      {(s || v) && (
        <div className="ok-chips" role="group" aria-label={h.period}>
          {PERIODS.map((p) => (
            <button key={p} type="button" className="ok-chip" aria-pressed={period === p} onClick={() => pick(p)}>{h.periods[p]}</button>
          ))}
        </div>
      )}

      {data && (s || v) && (
        <div className="ok-stats ok-home-stats">
          {s && s.cur.revenueKop !== null && <Stat label={h.revenue} icon="card" value={<span className="app-secret">{money(s.cur.revenueKop)}</span>} sub={<Delta cur={s.cur.revenueKop} prev={s.prev.revenueKop ?? 0} />} />}
          {s && <Stat label={h.orders} icon="cart" value={f.num(s.cur.orders)} sub={<Delta cur={s.cur.orders} prev={s.prev.orders} />} />}
          {canAnalytics && <Stat label={h.visits} icon="eye" value={v ? f.num(v.cur.sessions) : "—"} sub={v ? <Delta cur={v.cur.sessions} prev={v.prev.sessions} /> : <button type="button" className="ok-link" onClick={() => go("modules")}>{t.dash.noAnalytics}</button>} />}
          {canAnalytics && <Stat label={t.dash.conversion} icon="chart" value={conv(v?.cur) === null ? "—" : f.pct(conv(v?.cur)!)} />}
          {s && <Stat label={h.cancelled} icon="close" value={f.pct(cancelRate(s.cur))} sub={<Delta cur={cancelRate(s.cur)} prev={cancelRate(s.prev)} lowerIsBetter points />} />}
        </div>
      )}

      {s && (
        <div className="ok-grid-2">
          <Panel title={withMoney ? h.chart : h.orders}>
            {withMoney ? (
              <AreaChart a={series.map((x) => (x.revenueKop ?? 0) / 100)} b={series.map((x) => x.orders)} labelA={h.revenue} labelB={h.orders} />
            ) : (
              <AreaChart a={series.map((x) => x.orders)} labelA={h.orders} />
            )}
            {series.length > 1 && <p className="ok-axis ok-muted"><span>{axis(series[0]!.label)}</span><span>{axis(series[series.length - 1]!.label)}</span></p>}
          </Panel>
          {data?.goal && <Goal key={data.goal.goalKop ?? "none"} g={data.goal} onSaved={load} />}
        </div>
      )}

      {data && (
        <div className="ok-grid-2 ok-home-bottom">
          <TodoList todo={data.todo} go={go} onChange={load} />
          {data.ship && <ShipToday ship={data.ship} go={go} notify={show} />}
        </div>
      )}

      {data && (data.reviews || data.tips.length > 0) && (
        <div className="ok-grid-2">
          {data.reviews && (
            <Panel title={h.reviewsTitle} action={<button type="button" className="ok-link" onClick={() => go("reviews")}>{t.dash.all}</button>}>
              {data.reviews.length ? (
                <ul className="ok-list ok-home-reviews">
                  {data.reviews.map((r) => (
                    <li key={r.id}>
                      <span className="ok-grow"><b>{r.authorName} · {"★".repeat(r.rating)}</b><small>{r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text}</small></span>
                      {r.status === "pending" && <span className="ok-pill" data-s="new">{h.pending}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ok-muted">{h.noReviews}</p>
              )}
            </Panel>
          )}
          {data.tips.length > 0 && (
            <Panel title={h.tipsTitle}>
              <div className="ok-recs">{data.tips.map((i) => <TipCard key={i.id} i={i} go={go} onDone={load} />)}</div>
            </Panel>
          )}
        </div>
      )}
      <MyLeads />
      {flash}
    </div>
  );
}
