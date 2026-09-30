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
import { Tabs } from "./Tabs";
import { useToast } from "./Toasts";
import { Field } from "@/components/ui/Field";

type Data = {
  totals: { sessions: number; pageviews: number; leads: number; orders: number; contacts: number; revenueKop: number | null; conversion: number } | null;
  series: { date: string; sessions: number; orders: number }[];
  sources: { channel: string; campaign: string | null; sessions: number; leads: number; orders: number; revenueKop: number | null; source: string | null; medium: string | null }[];
  funnel?: { visits: number; product: number; cart: number; order: number };
  contacts?: Record<string, number>;
  pages?: { path: string | null; views: number; sessions: number }[];
  devices?: Record<string, number>;
  products?: { id: string; name: string; views: number; carts: number; sold: number; revenueKop: number | null }[];
  finance?: boolean;
};
type Ads = { rows: { channel: string; campaign: string | null; spentKop: number; sessions: number; orders: number; revenueKop: number; roi: number | null; costPerOrderKop: number | null }[]; spend: { id: string; channel: string; campaign: string | null; fromDate: string; toDate: string; amountKop: number }[] };
const TABS = ["overview", "sources", "funnel", "products", "ads", "install"] as const;

/** «Реклама»: spend entered by hand against orders and revenue from the same channel (money: «Фінанси» only). */
function AdsTab({ days }: { days: string }) {
  const d = useDict();
  const t = d.app.analytics;
  const lang = useLang();
  const f = useFormat();
  const toast = useToast();
  const [ads, setAds] = useState<Ads | null>(null);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const [form, setForm] = useState({ channel: "instagram", campaign: "", fromDate: today, toDate: today, amount: "" });
  const load = useCallback(async () => {
    const r = await api<Ads>(`/analytics/ads?days=${days}`);
    if (r.ok) setAds(r.data);
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);
  const money = (kop: number | null) => (kop === null ? "—" : formatUAH(kop / 100, lang));
  const channel = (c: string) => (t.channels as Record<string, string>)[c] ?? c.replace(/^other:/, "");
  return (
    <div className="grid gap-4">
      <Panel title={t.adsTitle}>
        {!ads?.rows.length ? (
          <p className="ok-muted">{t.adsEmpty}</p>
        ) : (
          <ul className="ok-list">
            {ads.rows.map((r) => (
              <li key={`${r.channel}${r.campaign}`}>
                <span className="ok-grow app-cell-main"><b>{channel(r.channel)}{r.campaign ? ` → ${r.campaign}` : ""}</b><small>{fmt(t.adsLine, { spent: money(r.spentKop), orders: r.orders, revenue: money(r.revenueKop), cpo: money(r.costPerOrderKop) })}</small></span>
                <b className="num app-secret" data-bad={r.roi !== null && r.roi < 1 || undefined}>{r.roi === null ? "—" : fmt(t.roi, { x: r.roi.toFixed(1).replace(".", ",") })}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="ok-muted">{t.adsHow}</p>
      </Panel>
      <Panel title={t.spendTitle}>
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await api("/analytics/spend", { method: "POST", body: { channel: form.channel, ...(form.campaign.trim() ? { campaign: form.campaign.trim() } : {}), fromDate: form.fromDate, toDate: form.toDate, amount: Number(form.amount.replace(",", ".")) } }); if (!r.ok) return toast.show(t.spendError, "warn"); setForm({ ...form, amount: "", campaign: "" }); void load(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.spendChannel}>
              {(p) => (
                <select {...p} className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                  {["instagram", "facebook", "google", "tiktok", "telegram", "youtube", "viber", "email"].map((c) => <option key={c} value={c}>{channel(c)}</option>)}
                </select>
              )}
            </Field>
            <Field label={t.spendCampaign} hint={t.spendCampaignHint}>{(p) => <input {...p} className="input" maxLength={150} value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} />}</Field>
            <Field label={t.spendFrom}>{(p) => <input {...p} className="input" type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />}</Field>
            <Field label={t.spendTo}>{(p) => <input {...p} className="input" type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />}</Field>
            <Field label={t.spendAmount}>{(p) => <input {...p} className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, "") })} />}</Field>
          </div>
          <button type="submit" className="btn btn-sm" style={{ justifySelf: "start" }} disabled={!Number(form.amount.replace(",", "."))}>{t.spendAdd}</button>
        </form>
        {!!ads?.spend.length && (
          <ul className="ok-list">
            {ads.spend.map((x) => (
              <li key={x.id}>
                <span className="ok-grow app-cell-main"><b>{channel(x.channel)}{x.campaign ? ` → ${x.campaign}` : ""}</b><small>{f.date(new Date(x.fromDate).getTime())} — {f.date(new Date(x.toDate).getTime())}</small></span>
                <b className="num app-secret">{money(x.amountKop)}</b>
                <button type="button" className="ok-link ok-danger" onClick={async () => { await api(`/analytics/spend/${x.id}`, { method: "DELETE" }); void load(); }}>{t.spendRemove}</button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

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
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
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
      <Tabs label={t.title} value={tab} onChange={setTab} tabs={TABS.filter((x) => x !== "ads" || data?.finance).map((x) => ({ id: x, label: t.tabs[x] }))} />
      {data && !hasData && tab !== "install" && tab !== "ads" && <Panel><p className="ok-muted">{t.empty}</p></Panel>}
      {hasData && tot && tab === "overview" && (
        <>
          <div className="ok-stats">
            <Stat label={t.visits} icon="eye" value={f.num(tot.sessions)} />
            <Stat label={t.leads} icon="chat" value={f.num(tot.leads)} />
            <Stat label={t.contacts} icon="phone" value={f.num(tot.contacts ?? 0)} />
            <Stat label={t.orders} icon="cart" value={f.num(tot.orders)} />
            {tot.revenueKop !== null && <Stat label={t.revenue} icon="card" value={<span className="app-secret">{formatUAH(tot.revenueKop / 100, lang)}</span>} />}
            <Stat label={t.conversion} icon="chart" value={f.pct(tot.conversion)} />
          </div>
          <Panel title={t.chart}>
            <AreaChart key={days} a={data!.series.map((s) => s.sessions)} b={data!.series.map((s) => s.orders)} labelA={t.visits} labelB={t.orders} height={200} />
          </Panel>
          <div className="app-two">
            <Panel title={t.pagesTitle}>
              <ul className="ok-list">
                {(data!.pages ?? []).map((p) => <li key={p.path ?? "-"}><span className="ok-grow num">{p.path ?? "/"}</span><small className="ok-muted">{fmt(t.pageViews, { v: f.num(p.views), s: f.num(p.sessions) })}</small></li>)}
              </ul>
            </Panel>
            <Panel title={t.devicesTitle}>
              <ul className="ok-list">
                {Object.entries(data!.devices ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}><span className="ok-grow">{(t.devices as Record<string, string>)[k] ?? k}</span><b className="num">{f.pct(n / Math.max(1, Object.values(data!.devices ?? {}).reduce((x, y) => x + y, 0)))}</b></li>)}
              </ul>
            </Panel>
          </div>
        </>
      )}
      {hasData && tab === "funnel" && data!.funnel && (
        <div className="grid gap-4">
          <Panel title={t.funnelTitle}>
            <ol className="app-funnel">
              {(["visits", "product", "cart", "order"] as const).map((k, i, all) => {
                const v = data!.funnel![k];
                const prev = i ? data!.funnel![all[i - 1]!] : v;
                return (
                  <li key={k} style={{ ["--w" as string]: data!.funnel!.visits ? v / data!.funnel!.visits : 0 }}>
                    <span className="app-funnel-bar" />
                    <b>{t.funnel[k]}</b>
                    <span className="num">{f.num(v)}</span>
                    {i > 0 && <small className="ok-muted">{fmt(t.stepConv, { p: f.pct(prev ? v / prev : 0) })}</small>}
                  </li>
                );
              })}
            </ol>
            <p className="ok-muted">{t.funnelHow}</p>
          </Panel>
          <Panel title={t.contactsTitle}>
            {Object.keys(data!.contacts ?? {}).length === 0 ? (
              <p className="ok-muted">{t.contactsEmpty}</p>
            ) : (
              <ul className="ok-list">
                {Object.entries(data!.contacts ?? {}).map(([k, n]) => <li key={k}><span className="ok-grow">{(t.contactKinds as Record<string, string>)[k] ?? k}</span><b className="num">{f.num(n)}</b></li>)}
              </ul>
            )}
            <p className="ok-muted">{t.contactsHow}</p>
          </Panel>
        </div>
      )}
      {hasData && tab === "products" && (
        <Panel title={t.productsTitle}>
          {!data!.products?.length ? (
            <p className="ok-muted">{t.productsEmpty}</p>
          ) : (
            <ul className="ok-list">
              {data!.products.map((p) => (
                <li key={p.id}>
                  <span className="ok-grow app-cell-main"><b>{p.name}</b><small>{fmt(t.productLine, { v: f.num(p.views), c: f.num(p.carts), s: f.num(p.sold) })}</small></span>
                  {p.revenueKop !== null && <b className="num app-secret">{formatUAH(p.revenueKop / 100, lang)}</b>}
                  <small className="ok-muted">{p.views ? fmt(t.buyRate, { p: f.pct(Math.min(1, p.sold / p.views)) }) : ""}</small>
                </li>
              ))}
            </ul>
          )}
          <p className="ok-muted">{t.productsHow}</p>
        </Panel>
      )}
      {tab === "ads" && data?.finance && <AdsTab days={days} />}
      {hasData && tab === "sources" && (
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
      )}
      {tab === "install" && (
      <Panel title={t.install}>
        <p className="ok-muted">{t.step1}</p>
        <pre className="app-code-block">{`<script src="${origin}/ok.js" data-key="${key}" defer></script>`}</pre>
        <p className="ok-muted">{t.step2}</p>
        <pre className="app-code-block">{"oneknight.track()"}</pre>
        <p className="ok-muted">{t.step3}</p>
        <pre className="app-code-block">{`{ ...order, analytics: oneknight.context() }`}</pre>
        <p className="ok-muted">{t.step4}</p>
        <pre className="app-code-block">{`<main data-ok-product="<id товару>">`}</pre>
        <p className="ok-muted">{t.step5}</p>
        <p className="ok-muted"><Icon name="shield" size={14} /> {t.privacy}</p>
      </Panel>
      )}
    </div>
  );
}
