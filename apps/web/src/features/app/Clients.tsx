"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Org = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  createdAt: string;
  sites: { id: string; domain: string; status: "building" | "live" | "paused"; lastUp: boolean | null }[];
  subscription: { status: "trial" | "active" | "grace" | "suspended" | "cancelled"; periodEnd: string } | null;
};

/** Admin: clients (organizations) and their sites. Adding a site starts monitoring immediately. */
export function Clients() {
  const d = useDict();
  const t = d.app.clients;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Org[]>("/admin/organizations");
    setError(!r.ok);
    if (r.ok) setOrgs(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      {error && <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>}
      {orgs && orgs.length === 0 && <Panel><p className="ok-muted">{t.empty}</p></Panel>}
      {(orgs ?? []).map((o) => (
        <Panel key={o.id} title={o.name} action={<small className="ok-muted">{f.date(new Date(o.createdAt).getTime())}</small>}>
          <p className="ok-muted">
            {o.ownerName} · {o.ownerEmail && <a className="ok-link" href={`mailto:${o.ownerEmail}`}>{o.ownerEmail}</a>} · {o.ownerPhone && <a className="ok-link" href={`tel:${o.ownerPhone.replace(/[^\d+]/g, "")}`}>{o.ownerPhone}</a>}
          </p>
          {o.sites.length > 0 && (
            <ul className="ok-list">
              {o.sites.map((s) => (
                <SiteRow key={s.id} s={s} onChanged={(msg) => { if (msg) show(msg); void load(); }} />
              ))}
            </ul>
          )}
          <div className="ok-actions">
            {o.subscription ? (
              <span className="ok-pill" data-s={o.subscription.status === "trial" || o.subscription.status === "active" ? "done" : "cancelled"}>
                {d.app.billing.status[o.subscription.status]} · {f.date(new Date(o.subscription.periodEnd).getTime())}
              </span>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" onClick={async () => { const r = await api(`/admin/organizations/${o.id}/trial`, { method: "POST", body: {} }); if (r.ok) { show(d.app.topupsAdmin.trialDone); void load(); } }}>
                {d.app.topupsAdmin.trial}
              </button>
            )}
          </div>
          <AddSite orgId={o.id} onAdded={() => { show(t.added); void load(); setTimeout(load, 12_000); }} />
        </Panel>
      ))}
      {flash}
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
