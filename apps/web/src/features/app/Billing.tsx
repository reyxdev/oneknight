"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { moduleCatalog } from "@/data/modules";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, Stat, useFlash, useFormat } from "@/features/oneknight/ui/kit";
import { moduleIcon } from "@/features/oneknight/ui/ModuleCard";

type Sub = { status: "trial" | "active" | "grace" | "suspended" | "cancelled"; trialEndsAt: string | null; periodEnd: string; graceUntil: string | null };
type Requisites = { recipient: string; iban: string; taxId: string | null } | null;
export type BillingData = {
  subscription: Sub | null;
  balanceKop: number;
  monthlyKop: number;
  monthlyFullKop: number;
  parts: { baseKop: number; modules: number; modulesKop: number; extraSites: number; sitesKop: number };
  yearKop: number;
  value: { orders: number; kop: number };
  discount: { percent: number; monthsLeft: number } | null;
  coveredUntil: string | null;
  modules: { id: string; free: boolean; paidUntil: string | null }[];
  freeModulesLeft: number;
  paymentsConfigured: boolean;
  requisites: Requisites;
  ledger: { id: string; kind: "topup" | "charge" | "refund" | "adjustment"; amountKop: number; reason: string; at: string }[];
  topups: { id: string; amountKop: number; reference: string; status: "pending" | "confirmed" | "cancelled"; at: string }[];
};

export function useBilling() {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    const r = await api<BillingData>("/billing");
    setError(!r.ok);
    if (r.ok) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, load };
}

const uah = (kop: number) => Math.round(kop) / 100;

function Copy({ value }: { value: string }) {
  const t = useDict().app.billing;
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ok-link"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t.copied : t.copy}
    </button>
  );
}

/** `onChange`: the account is re-read (the trial counter in the top bar). */
export function BillingScreen({ onChange }: { onChange?: () => void }) {
  const d = useDict();
  const t = d.app.billing;
  const lang = useLang();
  const f = useFormat();
  const money = (kop: number) => formatUAH(uah(kop), lang);
  const { data, error, load } = useBilling();
  const [amount, setAmount] = useState("500");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ reference: string; amountKop: number; requisites: Requisites } | null>(null);
  const [flash, show] = useFlash();
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [need, setNeed] = useState<number | null>(null);
  // «Почати підписку» / «Оплатити рік» from the balance; if it is not enough, the top-up form gets the missing sum.
  const pay = async (what: "subscribe" | "year") => {
    const r = await api<{ until: string }>(`/billing/${what}`, { method: "POST" });
    if (r.ok) {
      playSound("success");
      setNeed(null);
      show(fmt(what === "year" ? t.yearDone : t.subscribed, { date: f.date(new Date(r.data.until).getTime()) }));
      void load();
      onChange?.();
      return;
    }
    playSound("error");
    const missing = (r.body as { needKop?: number } | undefined)?.needKop;
    if (missing) {
      setNeed(missing);
      setAmount(String(Math.max(50, Math.ceil(missing / 100))));
    } else show(d.app.auth.errors.server_error, "warn");
  };

  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    type R = { type: "key"; kind: "oneknight" | "module"; moduleId: string | null; until: string } | { type: "promo"; kind: "percent" | "bonus"; value: number; months: number };
    const r = await api<R>("/billing/redeem", { method: "POST", body: { code } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setCodeErr((t.redeemErrors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error);
    }
    playSound("success");
    setCodeErr(null);
    setCode("");
    const x = r.data;
    show(
      x.type === "key"
        ? fmt(t.redeemed[x.kind], { date: f.date(new Date(x.until).getTime()), m: d.ok.modules.items[x.moduleId as keyof typeof d.ok.modules.items]?.name ?? "" })
        : fmt(t.redeemed[x.kind], { v: x.value, n: x.months }),
    );
    void load();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 50 || n > 100000) return setErr(t.errors.invalid_input);
    setBusy(true);
    const r = await api<{ reference: string; amountKop: number; requisites: Requisites }>("/billing/topups", { method: "POST", body: { amountUah: n } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr((t.errors as Record<string, string>)[r.error] ?? t.errors.server_error);
    }
    setErr(null);
    playSound("success");
    setFresh(r.data);
    void load();
  };

  if (error) return <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>;
  if (!data) return null;
  const s = data.subscription;
  const reason = (r: string) => (r === "renewal" ? t.reasons.renewal : r === "year" ? t.reasons.year : r.startsWith("promo:") ? `${t.promo} ${r.slice(6)}` : r.startsWith("module:") ? `${t.reasons.module}: ${d.ok.modules.items[r.slice(7) as keyof typeof d.ok.modules.items]?.name ?? r.slice(7)}` : r.startsWith("topup:") ? r.slice(6) : r);

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      {s?.status === "grace" && s.graceUntil && <div className="ok-alert" role="alert"><Icon name="bolt" size={18} /><div><p>{fmt(t.graceText, { date: f.date(new Date(s.graceUntil).getTime()) })}</p></div></div>}
      {s?.status === "suspended" && <div className="ok-alert" role="alert"><Icon name="bolt" size={18} /><div><p>{t.suspendedText}</p></div></div>}
      <div className="ok-stats">
        <Stat label={t.balance} icon="card" value={<span className="app-secret">{money(data.balanceKop)}</span>} tone={s && data.balanceKop < data.monthlyKop && s.status !== "trial" ? "bad" : undefined} />
        <Stat
          label={t.sub}
          icon="shield"
          value={s ? t.status[s.status] : "—"}
          tone={s?.status === "active" || s?.status === "trial" ? "ok" : s ? "bad" : undefined}
          sub={
            data.coveredUntil && new Date(data.coveredUntil) > new Date()
              ? fmt(t.coveredUntil, { date: f.date(new Date(data.coveredUntil).getTime()) })
              : s ? (s.status === "trial" ? fmt(t.trialUntil, { date: f.date(new Date(s.periodEnd).getTime()) }) : fmt(t.paidUntil, { date: f.date(new Date(s.periodEnd).getTime()) })) : undefined
          }
        />
        <Stat label={s?.status === "trial" ? t.monthly : t.monthlyActive} icon="refresh" value={money(data.monthlyKop)} sub={data.discount ? fmt(t.discount, { p: data.discount.percent, n: data.discount.monthsLeft }) : s?.status === "trial" ? fmt(t.freeModules, { n: data.freeModulesLeft }) : undefined} />
      </div>
      {data.value.orders > 0 && (
        <p className="app-value"><Icon name="chart" size={16} />{fmt(t.value, { n: data.value.orders, sum: money(data.value.kop) })}</p>
      )}
      {!s && (
        <Panel>
          <p className="ok-muted">{t.none}</p>
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={async () => { const r = await api("/billing/trial", { method: "POST" }); if (r.ok) { playSound("success"); void load(); onChange?.(); } else if (r.error === "trial_used") show(d.app.onboarding.trialUsed, "warn"); }}>{t.startTrial}</button>
        </Panel>
      )}
      <Panel title={t.planTitle}>
        <ul className="app-bill-parts">
          <li><span className="ok-grow">ONEKNIGHT</span><b className="num">{data.parts.baseKop ? money(data.parts.baseKop) : t.covered}</b></li>
          {data.parts.modules > 0 && <li><span className="ok-grow">{fmt(t.partModules, { n: data.parts.modules })}</span><b className="num">{money(data.parts.modulesKop)}</b></li>}
          {data.parts.extraSites > 0 && <li><span className="ok-grow">{fmt(t.partSites, { n: data.parts.extraSites })}</span><b className="num">{money(data.parts.sitesKop)}</b></li>}
          {data.discount && <li><span className="ok-grow">{fmt(t.discount, { p: data.discount.percent, n: data.discount.monthsLeft })}</span><b className="num">−{money(data.monthlyFullKop - data.monthlyKop)}</b></li>}
          <li className="app-bill-total"><span className="ok-grow">{s ? fmt(t.nextCharge, { date: f.date(new Date(s.periodEnd).getTime()) }) : t.firstCharge}</span><b className="num">{money(data.monthlyKop)}</b></li>
        </ul>
        <div className="ok-actions">
          {(!s || s.status === "cancelled" || s.status === "grace" || s.status === "suspended") && (
            <button type="button" className="btn btn-sm" onClick={() => pay("subscribe")}>{s && s.status !== "cancelled" ? t.renewNow : t.subscribe}</button>
          )}
          <button type="button" className={s?.status === "trial" ? "btn btn-sm" : "btn btn-sm btn-secondary"} onClick={() => pay("year")}>{fmt(t.payYear, { sum: money(data.yearKop) })}</button>
        </div>
        <p className="ok-muted">{fmt(t.yearHint, { m: 2 })}</p>
        {need !== null && <p className="field-error" role="alert">{fmt(t.needMore, { sum: money(need) })}</p>}
      </Panel>

      <Panel title={t.topUpTitle}>
        {!data.paymentsConfigured ? (
          <p className="ok-muted">{t.notConfigured}</p>
        ) : fresh ? (
          <div className="ok-topup">
            <dl>
              <div><dt>{t.amount}</dt><dd>{money(fresh.amountKop)}</dd></div>
              <div><dt>{t.recipient}</dt><dd>{fresh.requisites?.recipient} <Copy value={fresh.requisites?.recipient ?? ""} /></dd></div>
              <div><dt>{t.iban}</dt><dd className="num">{fresh.requisites?.iban} <Copy value={fresh.requisites?.iban ?? ""} /></dd></div>
              {fresh.requisites?.taxId && <div><dt>{t.taxId}</dt><dd className="num">{fresh.requisites.taxId} <Copy value={fresh.requisites.taxId} /></dd></div>}
              <div><dt>{t.purpose}</dt><dd><b>{fmt(t.purposeText, { ref: fresh.reference })}</b> <Copy value={fmt(t.purposeText, { ref: fresh.reference })} /></dd></div>
            </dl>
            <p className="ok-muted">{t.after}</p>
            <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={() => setFresh(null)}>{d.app.security.cancel}</button>
          </div>
        ) : (
          <form className="ok-form-row" onSubmit={create} noValidate>
            <Field label={t.amount} hint={t.amountHint} error={err ?? undefined}>
              {(p) => <input {...p} className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />}
            </Field>
            <span />
            <button className="btn" type="submit" disabled={busy} data-loading={busy}>{t.create}</button>
          </form>
        )}
      </Panel>

      <Panel title={t.redeemTitle}>
        <form className="ok-form-row" onSubmit={redeem} noValidate>
          <Field label={t.redeemCode} error={codeErr ?? undefined}>
            {(p) => <input {...p} className="input" placeholder={t.redeemHint} autoComplete="off" spellCheck={false} maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <span />
          <button className="btn btn-secondary" type="submit" disabled={busy || !code.trim()}>{t.redeem}</button>
        </form>
      </Panel>

      <div className="ok-grid-2">
        <Panel title={t.history}>
          {data.ledger.length === 0 ? (
            <p className="ok-muted">{t.empty}</p>
          ) : (
            <ul className="ok-list">
              {data.ledger.map((l) => (
                <li key={l.id}>
                  <span className="ok-grow"><b>{t.kinds[l.kind]}</b><small>{reason(l.reason)}</small></span>
                  <small className="ok-muted">{f.date(new Date(l.at).getTime())}</small>
                  <b className="num" style={{ color: l.amountKop < 0 ? "var(--bad)" : "var(--ok)" }}>{l.amountKop > 0 ? "+" : ""}{money(l.amountKop)}</b>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t.topups}>
          {data.topups.length === 0 ? (
            <p className="ok-muted">{t.empty}</p>
          ) : (
            <ul className="ok-list">
              {data.topups.map((x) => (
                <li key={x.id}>
                  <span className="ok-grow"><b className="num">{x.reference}</b><small>{f.date(new Date(x.at).getTime())}</small></span>
                  <b className="num">{money(x.amountKop)}</b>
                  <span className="ok-pill" data-s={x.status === "confirmed" ? "done" : x.status === "pending" ? "new" : "cancelled"}>{t.topupStatus[x.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {flash}
    </div>
  );
}

/** Real module store: only modules that actually work can be connected; the rest show "in development". */
export function ModulesScreen() {
  const d = useDict();
  const t = d.app.modulesApp;
  const lang = useLang();
  const f = useFormat();
  const { data, load } = useBilling();
  const [flash, show] = useFlash();
  const installed = new Set(data?.modules.map((m) => m.id));
  const byKey = (id: string) => {
    const until = data?.modules.find((m) => m.id === id)?.paidUntil;
    return until && new Date(until) > new Date() ? until : null;
  };
  const act = async (id: string, on: boolean) => {
    const r = await api(`/billing/modules/${id}`, { method: on ? "POST" : "DELETE", ...(on ? { body: {} } : {}) });
    if (!r.ok) {
      playSound("error");
      show((t.errors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error, "warn");
    } else playSound(on ? "install" : "click");
    void load();
  };
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-modules">
        {moduleCatalog.map((m) => {
          const item = d.ok.modules.items[m.id];
          const on = installed.has(m.id);
          return (
            <article key={m.id} className="ok-module" data-installed={on} data-soon={!m.live}>
              <header>
                <span className="ok-module-ic"><Icon name={moduleIcon[m.id]} size={20} /></span>
                <div>
                  <h5>{item.name}</h5>
                  <span className="ok-module-price num">{fmt(d.ok.modules.perMonth, { price: formatUAH(m.price, lang) })}</span>
                </div>
                <span className="ok-module-status">{!m.live ? t.soon : on ? t.installed : ""}</span>
              </header>
              <p>{item.desc}</p>
              <footer>
                {on && byKey(m.id) ? <small className="ok-muted">{fmt(t.byKey, { date: f.date(new Date(byKey(m.id)!).getTime()) })}</small> : <span />}
                {!m.live ? (
                  <button type="button" className="btn btn-sm btn-secondary" disabled>{t.soon}</button>
                ) : on ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(m.id, false)}>{t.remove}</button>
                ) : (
                  <button type="button" className="btn btn-sm" data-sound="off" onClick={() => act(m.id, true)}><Icon name="plus" size={16} />{t.install}</button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      {flash}
    </div>
  );
}
