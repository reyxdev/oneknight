"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { AreaChart, Panel, Stat, useFormat } from "@/features/oneknight/ui/kit";
import { SiteApiPanel } from "./Shop";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { Tabs } from "./Tabs";
import { useToast } from "./Toasts";

export type SiteInfo = {
  id: string;
  publicKey?: string;
  reviewModeration?: "off" | "manual";
  domain: string;
  name: string;
  status: "building" | "live" | "paused";
  checks30d: number;
  uptime30d: number | null;
  avgMs24h: number | null;
  last: { at: string; up: boolean; statusCode: number | null; responseMs: number | null; error: string | null } | null;
  sslDaysLeft: number | null;
  verifiedAt?: string | null;
  okSeenAt?: string | null;
  settings?: SiteSettings;
};
export type SiteSettings = { poweredBy?: boolean; widgetsOff?: boolean; socialProof?: boolean; reviewsBlock?: boolean; stars?: boolean };
type Audit = { last: { passed: number; total: number; createdAt: string; checks: { id: string; group: string; ok: boolean; value?: string | number | null; items?: string[] }[] } | null; history: { at: string; passed: number; total: number }[] };
const SITE_TABS = ["state", "quality", "settings", "api"] as const;

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

/** The ok.js line for the site and a text to send to the developer. */
function Install({ s }: { s: SiteInfo }) {
  const t = useDict().app.site;
  const toast = useToast();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oneknight.pro";
  const code = `<script src="${origin}/ok.js" data-key="${s.publicKey ?? ""}" defer></script>`;
  const brief = fmt(t.devText, { domain: s.domain, code });
  const copy = async (x: string, done: string) => {
    try {
      await navigator.clipboard.writeText(x);
      toast.show(done);
    } catch {
      toast.show(x);
    }
  };
  return (
    <div className="grid gap-2">
      <pre className="app-code-block">{code}</pre>
      <div className="ok-actions">
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => copy(code, t.copied)}>{t.copyCode}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(brief, t.devCopied)}>{t.devCopy}</button>
      </div>
    </div>
  );
}

/** A site waiting for ok.js: the code, «Перевірити зараз» (checked by itself every few minutes too), removing. */
function Pending({ s, onReload }: { s: SiteInfo; onReload: () => void }) {
  const t = useDict().app.site;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Panel title={t.pendingTitle}>
      <ol className="app-setup-steps">
        <li data-done="true"><b>{t.step1}</b><span>{s.domain}</span></li>
        <li><b>{t.step2}</b><span>{t.step2Hint}</span><Install s={s} /></li>
        <li><b>{t.step3}</b><span>{t.step3Hint}</span></li>
      </ol>
      <div className="ok-actions">
        <button type="button" className="btn btn-sm" disabled={busy} data-loading={busy} onClick={async () => { setBusy(true); const r = await api<{ verified: boolean }>(`/sites/${s.id}/verify`, { method: "POST", body: {} }); setBusy(false); if (r.ok && r.data.verified) { toast.show(t.verified); onReload(); } else toast.show(t.notFound, "warn"); }}>{t.verifyNow}</button>
        <button type="button" className="ok-link ok-danger" onClick={async () => { if (!confirm(fmt(t.removeAsk, { domain: s.domain }))) return; const r = await api(`/sites/${s.id}`, { method: "DELETE" }); if (r.ok) onReload(); }}>{t.remove}</button>
      </div>
      <p className="ok-muted">{t.pendingHint}</p>
    </Panel>
  );
}

/** «Додати сайт»: the domain first; then the code and the confirmation (the same card as a waiting site). */
function AddSite({ onAdded, onCancel }: { onAdded: () => void; onCancel?: () => void }) {
  const t = useDict().app.site;
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title={t.addTitle}>
      <p className="ok-muted">{t.addLead}</p>
      <form className="ok-form-row" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await api("/sites", { method: "POST", body: { domain } }); setBusy(false); if (!r.ok) return setErr((t.errors as Record<string, string>)[r.error] ?? t.errors.server_error); onAdded(); }}>
        <Field label={t.domain} hint={t.domainHint} error={err ?? undefined}>{(p) => <input {...p} className="input" inputMode="url" value={domain} onChange={(e) => { setDomain(e.target.value); setErr(null); }} />}</Field>
        <button type="submit" className="btn btn-sm" disabled={busy || !domain.trim()} data-loading={busy}>{t.addBtn}</button>
        {onCancel && <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>{t.cancel}</button>}
      </form>
      <p className="ok-muted">{t.addPrice}</p>
    </Panel>
  );
}

/** «Якість»: the weekly check with what to fix, and our services when it is about SEO or speed. */
function Quality({ s, canEdit, goServices }: { s: SiteInfo; canEdit: boolean; goServices: () => void }) {
  const d = useDict();
  const t = d.app.site;
  const f = useFormat();
  const toast = useToast();
  const [a, setA] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const r = await api<Audit>(`/sites/${s.id}/audit`);
    if (r.ok) setA(r.data);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);
  const run = async () => {
    setBusy(true);
    const r = await api(`/sites/${s.id}/audit`, { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) return toast.show(r.error === "site_unreachable" ? t.auditUnreachable : r.error === "too_many_requests" ? t.auditLimit : d.app.auth.errors.server_error, "warn");
    void load();
  };
  if (!a) return null;
  const groups = ["speed", "mobile", "seo", "links"] as const;
  const failed = a.last?.checks.filter((c) => !c.ok) ?? [];
  return (
    <div className="grid gap-4">
      <Panel title={t.qualityTitle} action={canEdit ? <button type="button" className="btn btn-sm btn-secondary" disabled={busy} data-loading={busy} onClick={run}>{t.auditNow}</button> : undefined}>
        {!a.last ? (
          <p className="ok-muted">{t.auditNone}</p>
        ) : (
          <>
            <div className="ok-stats">
              <Stat label={t.auditScore} icon="check" value={`${a.last.passed} / ${a.last.total}`} tone={failed.length ? "warn" : "ok"} sub={fmt(t.auditWhen, { ago: f.ago(new Date(a.last.createdAt).getTime()) })} />
            </div>
            {groups.map((g) => {
              const list = a.last!.checks.filter((c) => c.group === g);
              if (!list.length) return null;
              return (
                <fieldset key={g} className="app-q">
                  <legend>{t.auditGroups[g]}</legend>
                  <ul className="app-audit">
                    {list.map((c) => (
                      <li key={c.id} data-ok={c.ok}>
                        <Icon name={c.ok ? "check" : "close"} size={14} />
                        <span className="app-cell-main">
                          <b>{(t.audit as Record<string, string>)[c.id] ?? c.id}{c.value !== undefined && c.value !== null && c.value !== "" ? `: ${c.id === "response" ? fmt(t.ms, { n: c.value }) : c.id === "size" ? `${c.value} КБ` : String(c.value).slice(0, 90)}` : ""}</b>
                          {!c.ok && <small>{(t.tips as Record<string, string>)[c.id]}</small>}
                          {!c.ok && c.items?.length ? <small className="num">{c.items.join(", ")}</small> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
            {failed.some((c) => c.group === "seo" || c.group === "speed") && (
              <p className="ok-note">{t.offer} <button type="button" className="ok-link" onClick={goServices}>{t.offerCta}</button></p>
            )}
          </>
        )}
        <p className="ok-muted">{t.auditHow}</p>
      </Panel>
      {a.history.length > 1 && (
        <Panel title={t.auditHistory}>
          <ul className="ok-list">
            {a.history.map((h) => <li key={h.at}><span className="ok-grow">{f.date(new Date(h.at).getTime())}</span><b className="num">{h.passed} / {h.total}</b></li>)}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** «Налаштування»: the name, the widgets of ok.js (off all at once), «Зроблено на ONEKNIGHT». */
function Settings({ s, onReload }: { s: SiteInfo; onReload: () => void }) {
  const t = useDict().app.site;
  const toast = useToast();
  const [name, setName] = useState(s.name);
  const st = s.settings ?? {};
  const patch = async (body: object) => {
    const r = await api(`/sites/${s.id}`, { method: "PATCH", body });
    if (r.ok) {
      toast.show(t.saved);
      onReload();
    }
  };
  return (
    <div className="grid gap-4">
      <Panel title={t.settingsTitle}>
        <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); void patch({ name: name.trim() }); }}>
          <Field label={t.siteName}>{(p) => <input {...p} className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <button type="submit" className="btn btn-sm btn-secondary" disabled={!name.trim() || name.trim() === s.name}>{t.save}</button>
        </form>
        <Toggle checked={!!st.poweredBy} onChange={(v) => patch({ settings: { poweredBy: v } })} label={t.poweredBy} />
      </Panel>
      <Panel title={t.widgetsTitle}>
        <p className="ok-muted">{t.widgetsLead}</p>
        <Toggle checked={!!st.widgetsOff} onChange={(v) => patch({ settings: { widgetsOff: v } })} label={t.widgetsOff} />
        <fieldset className="app-q" disabled={!!st.widgetsOff}>
          <Toggle checked={!!st.socialProof} onChange={(v) => patch({ settings: { socialProof: v } })} label={t.socialProof} />
          <p className="ok-muted">{t.socialProofHint}</p>
          <Toggle checked={!!st.reviewsBlock} onChange={(v) => patch({ settings: { reviewsBlock: v } })} label={t.reviewsBlock} />
          <Toggle checked={!!st.stars} onChange={(v) => patch({ settings: { stars: v } })} label={t.stars} />
          <p className="ok-muted">{t.reviewsHint}</p>
        </fieldset>
      </Panel>
    </div>
  );
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
    <div className="grid gap-4">
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

/**
 * «Сайт»: sites of the business (chips), «+ Сайт» in 3 steps (domain → ok.js → confirmation), and for each site the
 * tabs Стан · Якість · Налаштування · API. A site waiting for ok.js shows its setup instead.
 */
export function SiteScreen({ canEdit = true, goServices }: { canEdit?: boolean; goServices: () => void }) {
  const d = useDict();
  const t = d.app.site;
  const { sites, error, load } = useSites();
  const [sel, setSel] = useState(0);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<(typeof SITE_TABS)[number]>("state");
  if (error) return <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>;
  if (!sites) return null;
  if (!sites.length)
    return (
      <div className="ok-screen">
        <div className="ok-h"><h3>{t.title}</h3></div>
        {canEdit ? <AddSite onAdded={load} /> : <Panel><p className="ok-muted">{t.empty}</p></Panel>}
      </div>
    );
  const cur = sites[Math.min(sel, sites.length - 1)]!;
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{cur.name}</h3>
        <a className="btn btn-sm btn-secondary" href={`https://${cur.domain}`} target="_blank" rel="noopener">{cur.domain}<Icon name="arrow" size={15} /></a>
      </div>
      {(sites.length > 1 || canEdit) && (
        <div className="ok-chips" role="tablist" aria-label={t.title}>
          {sites.map((s, i) => (
            <button key={s.id} type="button" role="tab" className="ok-chip" aria-selected={i === sel && !adding} aria-pressed={i === sel && !adding} onClick={() => { setSel(i); setAdding(false); }}>
              {s.domain}{!s.verifiedAt && <span className="ok-pill" data-s="shipped">{t.pendingShort}</span>}
            </button>
          ))}
          {canEdit && <button type="button" className="ok-chip" aria-pressed={adding} onClick={() => setAdding(true)}><Icon name="plus" size={13} />{t.addChip}</button>}
        </div>
      )}
      {adding ? (
        <AddSite onAdded={() => { setAdding(false); void load().then(() => setSel(sites.length)); }} onCancel={() => setAdding(false)} />
      ) : !cur.verifiedAt ? (
        canEdit ? <Pending s={cur} onReload={load} /> : <Panel><p className="ok-muted">{t.pendingTitle}</p></Panel>
      ) : (
        <>
          <Tabs label={cur.domain} value={tab} onChange={setTab} tabs={SITE_TABS.filter((x) => canEdit || x === "state" || x === "quality").map((x) => ({ id: x, label: t.tabs[x] }))} />
          {tab === "state" && <SiteCard s={cur} key={cur.id} />}
          {tab === "quality" && <Quality s={cur} key={cur.id} canEdit={canEdit} goServices={goServices} />}
          {tab === "settings" && canEdit && <Settings s={cur} key={cur.id} onReload={load} />}
          {tab === "api" && canEdit && (
            <div className="grid gap-4">
              <Panel title={t.installTitle}>
                <p className="ok-muted">{t.installLead}</p>
                <Install s={cur} />
                <p className="ok-muted">{cur.okSeenAt ? fmt(t.okSeen, { ago: new Date(cur.okSeenAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }) }) : t.okNotSeen}</p>
              </Panel>
              {cur.publicKey && <SiteApiPanel site={cur} onRotated={load} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
