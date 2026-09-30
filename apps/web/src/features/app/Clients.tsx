"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fmt } from "@/i18n";
import { useDict, useLang } from "@/i18n/provider";
import { formatUAH } from "@/data/pricing";
import { Table, useEscClose, type Col, type Sort } from "./Table";
import { Tabs } from "./Tabs";
import { useToast } from "./Toasts";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";

type Org = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  createdAt: string;
  sites: { id: string; domain: string; status: "building" | "live" | "paused"; lastUp: boolean | null }[];
  subscription: { status: "trial" | "active" | "grace" | "suspended" | "cancelled"; periodEnd: string } | null;
  deletable: boolean;
  purgedAt: string | null;
};

/** Admin: clients (organizations) and their sites. Adding a site starts monitoring immediately. */
/** Admin: one-time link to set a new password (there is no email sending). */
function PasswordReset() {
  const t = useDict().app.clients;
  const [email, setEmail] = useState("");
  const [totp, setTotp] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api<{ token: string }>("/admin/password-reset", { method: "POST", body: { email, resetTotp: totp } });
    if (!r.ok) {
      playSound("error");
      return setErr((t.resetErrors as Record<string, string>)[r.error] ?? t.resetErrors.invalid_input);
    }
    setErr(null);
    setLink(`${location.origin}${location.pathname}?reset=${r.data.token}`);
  };
  return (
    <Panel title={t.resetTitle}>
      <p className="ok-muted">{t.resetLead}</p>
      <form className="grid gap-3" onSubmit={create} noValidate>
        <Field label={t.resetEmail} error={err ?? undefined}>{(p) => <input {...p} className="input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setLink(null); }} />}</Field>
        <Toggle checked={totp} onChange={setTotp} label={t.resetTotp} />
        <button className="btn btn-sm" type="submit" disabled={!email.includes("@")} style={{ justifySelf: "start" }}>{t.resetCreate}</button>
      </form>
      {link && <Field label={t.resetLink}>{(p) => <input {...p} className="input" readOnly value={link} onFocus={(e) => e.target.select()} />}</Field>}
    </Panel>
  );
}

type Row = {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
  contract: boolean;
  purgedAt: string | null;
  owner: { name: string | null; email: string | null; phone: string | null };
  status: "trial" | "active" | "grace" | "suspended" | "cancelled" | null;
  periodEnd: string | null;
  balanceKop: number;
  modules: number;
  lastSeen: string | null;
  orders30: number;
  notes: number;
};
type Card = {
  id: string;
  name: string;
  tags: string[];
  contract: boolean;
  features: string[];
  createdAt: string;
  purgedAt: string | null;
  deletable: boolean;
  team: { name: string; email: string; phone: string; role: string; lastSeen: string | null }[];
  notes: { id: string; text: string; at: string; by: string | null }[];
  sites: Org["sites"];
  billing: { subscription: { status: NonNullable<Row["status"]>; periodEnd: string } | null; balanceKop: number; monthlyKop: number; modules: { id: string }[]; ledger: { id: string; kind: string; amountKop: number; reason: string; at: string }[] };
};
const STATES = ["all", "trial", "active", "grace", "suspended", "contract"] as const;
const CARD_TABS = ["overview", "billing", "sites", "notes"] as const;

/** One business: overview with actions (view the panel, 3 months, delete data), billing with adjustments, sites, notes. */
function ClientCard({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const d = useDict();
  const t = d.app.clients;
  const lang = useLang();
  const f = useFormat();
  const toast = useToast();
  const [c, setC] = useState<Card | null>(null);
  const [tab, setTab] = useState<(typeof CARD_TABS)[number]>("overview");
  const [adj, setAdj] = useState({ amount: "", reason: "" });
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const load = useCallback(async () => {
    const r = await api<Card>(`/admin/clients/${id}`);
    if (r.ok) {
      setC(r.data);
      setTags(r.data.tags.join(", "));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!c) return null;
  const money = (kop: number) => formatUAH(kop / 100, lang);
  const done = (msg: string) => {
    toast.show(msg);
    void load();
    onChanged();
  };
  const patch = async (body: object) => {
    const r = await api(`/admin/clients/${id}`, { method: "PATCH", body });
    if (r.ok) done(t.saved);
  };
  const view = async () => {
    const r = await api(`/admin/view/${id}`, { method: "POST", body: {} });
    if (!r.ok) return;
    history.replaceState(null, "", `${location.pathname}#home`);
    location.reload();
  };
  return (
    <Panel className="ok-detail" title={c.name} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <Tabs label={c.name} value={tab} onChange={setTab} tabs={CARD_TABS.map((x) => ({ id: x, label: t.tabs[x] }))} />
      {tab === "overview" && (
        <div className="grid gap-4">
          <div className="ok-kv">
            <div><span>{t.state}</span><b>{c.billing.subscription ? `${d.app.billing.status[c.billing.subscription.status]} · ${f.date(new Date(c.billing.subscription.periodEnd).getTime())}` : t.noSub}</b></div>
            <div><span>{t.since}</span><b>{f.date(new Date(c.createdAt).getTime())}</b></div>
          </div>
          <ul className="ok-list">
            {c.team.map((m) => (
              <li key={m.email}>
                <span className="ok-grow app-cell-main"><b>{m.name}</b><small>{d.app.team.roles[m.role as keyof typeof d.app.team.roles] ?? m.role} · <a className="ok-link" href={`tel:${m.phone.replace(/[^\d+]/g, "")}`}>{m.phone}</a> · <a className="ok-link" href={`mailto:${m.email}`}>{m.email}</a></small></span>
                <small className="ok-muted">{m.lastSeen ? f.ago(new Date(m.lastSeen).getTime()) : "—"}</small>
              </li>
            ))}
          </ul>
          <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); void patch({ tags: tags.split(",").map((x) => x.trim()).filter(Boolean) }); }}>
            <Field label={t.tags} hint={t.tagsHint}>{(p) => <input {...p} className="input" value={tags} onChange={(e) => setTags(e.target.value)} />}</Field>
            <button type="submit" className="btn btn-sm btn-secondary">{t.save}</button>
          </form>
          <Toggle checked={c.contract} onChange={(v) => patch({ contract: v })} label={t.contract} />
          <Toggle checked={c.features.includes("content")} onChange={(v) => patch({ features: v ? [...c.features, "content"] : c.features.filter((x) => x !== "content") })} label={t.betaContent} />
          <div className="ok-actions">
            <button type="button" className="btn btn-sm" onClick={view}><Icon name="eye" size={15} />{t.view}</button>
            {(!c.billing.subscription || c.billing.subscription.status === "trial") && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={async () => { const r = await api(`/admin/organizations/${id}/trial`, { method: "POST", body: {} }); if (r.ok) done(d.app.topupsAdmin.trialDone); }}>{d.app.topupsAdmin.trial}</button>
            )}
            {c.deletable && (
              <button type="button" className="btn btn-sm btn-ghost ok-danger" onClick={async () => { if (!confirm(fmt(d.app.admin.purgeConfirm, { name: c.name }))) return; const r = await api(`/admin/organizations/${id}/purge`, { method: "POST", body: {} }); if (r.ok) done(d.app.admin.purged); }}>{d.app.admin.purge}</button>
            )}
            {c.purgedAt && <span className="ok-pill" data-s="cancelled">{d.app.admin.purgedPill}</span>}
          </div>
          <p className="ok-muted">{t.viewHint}</p>
        </div>
      )}
      {tab === "billing" && (
        <div className="grid gap-4">
          <div className="ok-kv">
            <div><span>{t.balance}</span><b className="num app-secret">{money(c.billing.balanceKop)}</b></div>
            <div><span>{t.nextCharge}</span><b className="num app-secret">{money(c.billing.monthlyKop)}</b></div>
          </div>
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const amountUah = Number(adj.amount.replace(",", ".")); const r = await api(`/admin/clients/${id}/adjust`, { method: "POST", body: { amountUah, reason: adj.reason.trim() } }); if (!r.ok) return toast.show(t.adjustError, "warn"); setAdj({ amount: "", reason: "" }); done(t.adjusted); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.adjustAmount} hint={t.adjustAmountHint}>{(p) => <input {...p} className="input" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value.replace(/[^\d.,-]/g, "") })} />}</Field>
              <Field label={t.adjustReason} hint={t.adjustReasonHint}>{(p) => <input {...p} className="input" maxLength={200} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />}</Field>
            </div>
            <button type="submit" className="btn btn-sm" style={{ justifySelf: "start" }} disabled={!Number(adj.amount.replace(",", ".")) || adj.reason.trim().length < 3}>{t.adjust}</button>
          </form>
          <ul className="ok-list">
            {c.billing.ledger.map((l) => (
              <li key={l.id}>
                <span className="ok-grow app-cell-main"><b>{d.app.billing.kinds[l.kind as keyof typeof d.app.billing.kinds] ?? l.kind}</b><small>{l.reason}</small></span>
                <b className="num app-secret" data-bad={l.amountKop < 0 || undefined}>{l.amountKop > 0 ? "+" : ""}{money(l.amountKop)}</b>
                <small className="ok-muted">{f.date(new Date(l.at).getTime())}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === "sites" && (
        <div className="grid gap-3">
          {c.sites.length > 0 && <ul className="ok-list">{c.sites.map((s) => <SiteRow key={s.id} s={s} onChanged={(msg) => { if (msg) toast.show(msg); void load(); }} />)}</ul>}
          <AddSite orgId={id} onAdded={() => { done(t.added); setTimeout(load, 12_000); }} />
        </div>
      )}
      {tab === "notes" && (
        <div className="grid gap-3">
          <form className="ok-form-row" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await api(`/admin/clients/${id}/notes`, { method: "POST", body: { text: note.trim() } }); setNote(""); done(t.noteAdded); }}>
            <Field label={t.note}>{(p) => <input {...p} className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <button type="submit" className="btn btn-sm btn-secondary" disabled={!note.trim()}>{t.add}</button>
          </form>
          {c.notes.length > 0 && <ol className="app-timeline">{c.notes.map((n) => <li key={n.id}><span className="app-timeline-what">{n.text}</span><small className="ok-muted">{f.dateTime(new Date(n.at).getTime())}{n.by ? ` · ${n.by}` : ""}</small></li>)}</ol>}
        </div>
      )}
    </Panel>
  );
}

/** Admin «Бізнеси»: every business as a table (search, state filters), the card on the right. `tab` "c-<id>" opens one. */
export function Clients({ tab }: { tab?: string | null }) {
  const d = useDict();
  const t = d.app.clients;
  const lang = useLang();
  const f = useFormat();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(tab?.startsWith("c-") ? tab.slice(2) : null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<(typeof STATES)[number]>("all");
  const [sort, setSort] = useState<Sort>({ key: "since", dir: "desc" });
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
    const r = await api<Row[]>("/admin/clients");
    setError(!r.ok);
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEscClose(open ? () => setOpen(null) : null);
  const needle = q.trim().toLowerCase();
  const list = (rows ?? []).filter(
    (r) =>
      (state === "all" || (state === "contract" ? r.contract : r.status === state)) &&
      (!needle || [r.name, r.owner.name, r.owner.email, r.owner.phone, ...r.tags].some((x) => (x ?? "").toLowerCase().includes(needle))),
  );
  const cols: Col<Row>[] = [
    { key: "name", label: t.colName, fixed: true, sort: (r) => r.name, render: (r) => <span className="app-cell-main"><b>{r.name}</b><small>{r.tags.map((x) => <span key={x} className="app-tag">{x}</span>)}</small></span> },
    { key: "owner", label: t.colOwner, render: (r) => <span className="app-cell-main"><span>{r.owner.name}</span><small className="num">{r.owner.phone}</small></span> },
    { key: "state", label: t.colState, render: (r) => (r.status ? <span className="ok-pill" data-s={r.status === "trial" || r.status === "active" ? "done" : r.status === "grace" ? "shipped" : "cancelled"}>{d.app.billing.status[r.status]}</span> : <span className="ok-muted">{t.noSub}</span>) },
    { key: "balance", label: t.balance, align: "end", sort: (r) => r.balanceKop, render: (r) => <span className="num app-secret">{formatUAH(r.balanceKop / 100, lang)}</span> },
    { key: "modules", label: t.colModules, align: "end", sort: (r) => r.modules, render: (r) => <span className="num">{r.modules}</span> },
    { key: "seen", label: t.colSeen, sort: (r) => (r.lastSeen ? new Date(r.lastSeen).getTime() : 0), render: (r) => (r.lastSeen ? f.ago(new Date(r.lastSeen).getTime()) : "—") },
    { key: "orders", label: t.colOrders, align: "end", sort: (r) => r.orders30, render: (r) => <span className="num">{r.orders30}</span> },
    { key: "contract", label: t.colContract, render: (r) => (r.contract ? <span className="ok-pill" data-s="paid">{t.contractShort}</span> : null) },
    { key: "since", label: t.since, sort: (r) => new Date(r.createdAt).getTime(), render: (r) => f.date(new Date(r.createdAt).getTime()) },
  ];
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <div className="ok-chips app-products-filters">
        <label className="app-search-inline">
          <Icon name="search" size={14} />
          <input className="input" type="search" aria-label={t.search} placeholder={t.search} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
        {STATES.map((s) => <button key={s} type="button" className="ok-chip" aria-pressed={state === s} onClick={() => { setState(s); setPage(1); }}>{t.states[s]}</button>)}
      </div>
      {error && <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>}
      <div className="ok-split" data-open={!!open}>
        <Panel>
          {rows && list.length === 0 ? <p className="ok-muted">{t.empty}</p> : <Table id="clients" label={t.title} rows={list} cols={cols} active={open} onOpen={(r) => setOpen(r.id)} sort={sort} onSort={setSort} page={page} onPage={setPage} />}
        </Panel>
        {open && <ClientCard key={open} id={open} onChanged={load} onClose={() => setOpen(null)} />}
      </div>
      <PasswordReset />
    </div>
  );
}

function SiteRow({ s, onChanged }: { s: Org["sites"][number]; onChanged: (msg?: string) => void }) {
  const t = useDict().app.clients;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    await api(`/admin/sites/${s.id}/check`, { method: "POST", body: {} });
    setBusy(false);
    onChanged(t.checked);
  };
  const status = async (st: "live" | "paused") => {
    await api(`/admin/sites/${s.id}`, { method: "PATCH", body: { status: st } });
    onChanged();
  };
  const remove = async () => {
    await api(`/admin/sites/${s.id}`, { method: "DELETE" });
    onChanged();
  };
  return (
    <li>
      <i className="ok-state" data-s={s.status !== "live" ? "warn" : s.lastUp === false ? "bad" : "ok"} aria-hidden="true" />
      <a className="ok-grow" href={`https://${s.domain}`} target="_blank" rel="noopener"><b>{s.domain}</b></a>
      {confirm ? (
        <span className="ok-actions">
          <span className="ok-muted">{t.removeConfirm}</span>
          <button type="button" className="btn btn-sm" onClick={remove}>{t.yes}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>{t.no}</button>
        </span>
      ) : (
        <span className="ok-actions">
          <button type="button" className="ok-link" onClick={check} disabled={busy}>{t.check}</button>
          <button type="button" className="ok-link" onClick={() => status(s.status === "live" ? "paused" : "live")}>{s.status === "live" ? t.pause : t.resume}</button>
          <button type="button" className="ok-link ok-danger" onClick={() => setConfirm(true)}>{t.remove}</button>
        </span>
      )}
    </li>
  );
}

function AddSite({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const t = useDict().app.clients;
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api("/admin/sites", { method: "POST", body: { organizationId: orgId, domain, ...(name.trim() ? { name } : {}) } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr((t.errors as Record<string, string>)[r.error] ?? t.errors.server_error);
    }
    setErr(null);
    setDomain("");
    setName("");
    playSound("success");
    onAdded();
  };
  return (
    <form className="ok-form-row" onSubmit={submit} noValidate aria-label={t.addSite}>
      <label className="field"><span className="label">{t.domain}</span><input className="input" value={domain} placeholder={t.domainHint} onChange={(e) => setDomain(e.target.value)} aria-invalid={err ? true : undefined} /></label>
      <label className="field"><span className="label">{t.siteName}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="btn" type="submit" disabled={busy || !domain.trim()} data-loading={busy}><Icon name="plus" size={16} />{t.add}</button>
      {err && <p className="field-error" role="alert" style={{ gridColumn: "1 / -1" }}>{err}</p>}
    </form>
  );
}
