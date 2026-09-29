"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api, latestOnly } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Item = { provider: string; available: boolean; status: string; settings: PromSettings; lastError: string | null; connectedAt: string | null };
type PromSettings = { lastSyncAt?: string };
export type NpCity = { ref: string; name: string; area: string };
export type NpWarehouse = { ref: string; name: string; number: string };
export type NpPick = { city: NpCity | null; warehouse: NpWarehouse | null };

/** Search-as-you-type list backed by the Nova Poshta address directory. */
function useSearch<T>(path: (q: string) => string | null, initial: T[] = []) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<T[]>(initial);
  const [guard] = useState(latestOnly);
  useEffect(() => {
    const url = path(q);
    if (url === null) return;
    const isLatest = guard();
    const t = setTimeout(async () => {
      const r = await api<T[]>(url);
      if (r.ok && isLatest()) setList(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, path, guard]);
  return { q, setQ, list };
}

/** City + branch picker. `initial` lists come from the API (e.g. the ambiguous-address response). */
export type Carrier = "novaposhta" | "ukrposhta";

export function NpPicker({ provider = "novaposhta", labels, value, onChange, initialCities = [], initialWarehouses = [] }: { provider?: Carrier; labels: { city: string; branch: string }; value: NpPick; onChange: (v: NpPick) => void; initialCities?: NpCity[]; initialWarehouses?: NpWarehouse[] }) {
  const t = useDict().app.integrations;
  const cityPath = useCallback((q: string) => (q.trim().length >= 2 ? `/integrations/${provider}/cities?q=${encodeURIComponent(q.trim())}` : null), [provider]);
  const cityRef = value.city?.ref;
  const whPath = useCallback((q: string) => (cityRef ? `/integrations/${provider}/warehouses?city=${encodeURIComponent(cityRef)}&q=${encodeURIComponent(q.trim())}` : null), [cityRef, provider]);
  const cities = useSearch<NpCity>(cityPath, initialCities);
  const whs = useSearch<NpWarehouse>(whPath, initialWarehouses);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-2">
        <Field label={labels.city}>{(p) => <input {...p} className="input" placeholder={value.city?.name ?? t.cityPh} value={cities.q} onChange={(e) => cities.setQ(e.target.value)} />}</Field>
        {value.city && <b className="app-picked"><Icon name="check" size={14} /> {value.city.name}{value.city.area ? `, ${value.city.area}` : ""}</b>}
        <ul className="ok-list app-options">
          {cities.list.filter((c) => c.ref !== value.city?.ref).map((c) => (
            <li key={c.ref}><button type="button" className="ok-link" onClick={() => { onChange({ city: c, warehouse: null }); cities.setQ(""); }}>{c.name}{c.area ? `, ${c.area}` : ""}</button></li>
          ))}
        </ul>
      </div>
      <div className="grid gap-2">
        <Field label={labels.branch}>{(p) => <input {...p} className="input" disabled={!value.city} placeholder={value.warehouse?.name ?? t.branchPh} value={whs.q} onChange={(e) => whs.setQ(e.target.value)} />}</Field>
        {value.warehouse && <b className="app-picked"><Icon name="check" size={14} /> {value.warehouse.name}</b>}
        {value.city && (
          <ul className="ok-list app-options">
            {whs.list.filter((w) => w.ref !== value.warehouse?.ref).map((w) => (
              <li key={w.ref}><button type="button" className="ok-link" onClick={() => { onChange({ ...value, warehouse: w }); whs.setQ(""); }}>{w.name}</button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Only the key lives here; sender address, weight and printing are in the order («Оформити ТТН»). */
function NovaPoshta({ item, reload }: { item: Item; reload: () => void }) {
  const d = useDict();
  const t = d.app.integrations;
  const [flash, show] = useFlash();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connected = item.status === "connected";

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api<{ sender: { name: string } }>("/integrations/novaposhta/connect", { method: "POST", body: { apiKey: key.trim() } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      const detail = (r.body as { detail?: string } | undefined)?.detail;
      return show(`${(t.errors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error}${detail ? `: ${detail}` : ""}`, "warn");
    }
    playSound("success");
    setKey("");
    reload();
  };
  const disconnect = async () => {
    await api("/integrations/novaposhta", { method: "DELETE" });
    setConfirm(false);
    reload();
  };

  return (
    <Panel title={t.names.novaposhta} action={<span className="ok-muted">{connected ? t.connected : t.notConnected}</span>}>
      <p className="ok-muted">{t.npAbout}</p>
      {!connected ? (
        <form className="grid gap-3" onSubmit={connect}>
          <ol className="ok-steps">{t.npSteps.map((x) => <li key={x}>{x}</li>)}</ol>
          <Field label={t.apiKey}>{(p) => <input {...p} className="input" autoComplete="off" spellCheck={false} maxLength={40} value={key} onChange={(e) => setKey(e.target.value)} />}</Field>
          <button className="btn btn-sm" type="submit" disabled={busy || key.trim().length < 32} style={{ justifySelf: "start" }}>{busy ? t.checking : t.connect}</button>
        </form>
      ) : (
        <div className="grid gap-3">
          <p className="ok-note">{t.npReady}</p>
          {item.lastError && <p className="ok-note">{t.lastError}: {item.lastError}</p>}
          <div className="ok-actions">
            {confirm ? (
              <>
                <span className="ok-muted">{t.confirmDisconnect}</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={disconnect}>{t.disconnect}</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirm(true)}>{t.disconnect}</button>
            )}
          </div>
        </div>
      )}
      {flash}
    </Panel>
  );
}

type UpSenderType = "PRIVATE_ENTREPRENEUR" | "COMPANY" | "INDIVIDUAL";

/** Ukrposhta: bearer + counterparty token from the contract, and who sends (a sender client is created from it). */
function Ukrposhta({ item, reload }: { item: Item; reload: () => void }) {
  const d = useDict();
  const t = d.app.integrations;
  const [flash, show] = useFlash();
  const [f, setF] = useState({ bearer: "", token: "", type: "PRIVATE_ENTREPRENEUR" as UpSenderType, lastName: "", firstName: "", middleName: "", companyName: "", phone: "", tin: "", edrpou: "", bankAccount: "" });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connected = item.status === "connected";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const sender =
      f.type === "COMPANY"
        ? { type: f.type, companyName: opt(f.companyName), edrpou: opt(f.edrpou), phone: f.phone, bankAccount: opt(f.bankAccount.replace(/\s/g, "")) }
        : { type: f.type, lastName: opt(f.lastName), firstName: opt(f.firstName), middleName: opt(f.middleName), phone: f.phone, ...(f.type === "PRIVATE_ENTREPRENEUR" ? { tin: opt(f.tin) } : {}), bankAccount: opt(f.bankAccount.replace(/\s/g, "")) };
    setBusy(true);
    const r = await api("/integrations/ukrposhta/connect", { method: "POST", body: { bearer: f.bearer.trim(), token: f.token.trim(), sender } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      const detail = (r.body as { detail?: string } | undefined)?.detail;
      return show(`${(t.upErrors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error}${detail ? `: ${detail}` : ""}`, "warn");
    }
    playSound("success");
    reload();
  };
  const disconnect = async () => {
    await api("/integrations/ukrposhta", { method: "DELETE" });
    setConfirm(false);
    reload();
  };
  const person = f.type !== "COMPANY";
  return (
    <Panel title={t.names.ukrposhta} action={<span className="ok-muted">{connected ? t.connected : t.notConnected}</span>}>
      <p className="ok-muted">{t.upAbout}</p>
      {!connected ? (
        <form className="grid gap-3" onSubmit={connect} noValidate>
          <ol className="ok-steps">{t.upSteps.map((x) => <li key={x}>{x}</li>)}</ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.upBearer}>{(p) => <input {...p} className="input" autoComplete="off" spellCheck={false} maxLength={200} value={f.bearer} onChange={set("bearer")} />}</Field>
            <Field label={t.upToken}>{(p) => <input {...p} className="input" autoComplete="off" spellCheck={false} maxLength={200} value={f.token} onChange={set("token")} />}</Field>
            <Field label={t.upSenderType}>
              {(p) => (
                <select {...p} className="input" value={f.type} onChange={set("type")}>
                  {(["PRIVATE_ENTREPRENEUR", "COMPANY", "INDIVIDUAL"] as const).map((x) => <option key={x} value={x}>{t.upTypes[x]}</option>)}
                </select>
              )}
            </Field>
            <Field label={t.upPhone}>{(p) => <input {...p} className="input" type="tel" value={f.phone} onChange={set("phone")} />}</Field>
            {person ? (
              <>
                <Field label={t.upLastName}>{(p) => <input {...p} className="input" value={f.lastName} onChange={set("lastName")} />}</Field>
                <Field label={t.upFirstName}>{(p) => <input {...p} className="input" value={f.firstName} onChange={set("firstName")} />}</Field>
                <Field label={f.type === "INDIVIDUAL" ? t.upMiddleNameReq : t.upMiddleName}>{(p) => <input {...p} className="input" value={f.middleName} onChange={set("middleName")} />}</Field>
                {f.type === "PRIVATE_ENTREPRENEUR" && <Field label={t.upTin}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={10} value={f.tin} onChange={set("tin")} />}</Field>}
              </>
            ) : (
              <>
                <Field label={t.upCompany}>{(p) => <input {...p} className="input" value={f.companyName} onChange={set("companyName")} />}</Field>
                <Field label={t.upEdrpou}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={8} value={f.edrpou} onChange={set("edrpou")} />}</Field>
              </>
            )}
            {f.type !== "INDIVIDUAL" && <Field label={t.upIban} hint={t.upIbanHint}>{(p) => <input {...p} className="input" spellCheck={false} maxLength={34} value={f.bankAccount} onChange={set("bankAccount")} />}</Field>}
          </div>
          <button className="btn btn-sm" type="submit" disabled={busy || f.bearer.trim().length < 10 || f.token.trim().length < 10} style={{ justifySelf: "start" }}>{busy ? t.checking : t.connect}</button>
        </form>
      ) : (
        <div className="grid gap-3">
          <p className="ok-note">{t.upReady}</p>
          {item.lastError && <p className="ok-note">{t.lastError}: {item.lastError}</p>}
          <div className="ok-actions">
            {confirm ? (
              <>
                <span className="ok-muted">{t.confirmDisconnect}</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={disconnect}>{t.disconnect}</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirm(true)}>{t.disconnect}</button>
            )}
          </div>
        </div>
      )}
      {flash}
    </Panel>
  );
}

type MarketConfig = {
  provider: "prom" | "rozetka";
  about: string;
  steps: readonly string[];
  fields: { key: string; label: string; type?: "password"; min: number }[];
  errors: Record<string, string>;
};

/** Marketplace orders import (Prom, Rozetka): connect with the seller's credentials, then sync. */
function Marketplace({ item, cfg, reload }: { item: Item; cfg: MarketConfig; reload: () => void }) {
  const d = useDict();
  const t = d.app.integrations;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connected = item.status !== "not_connected";
  const errText = (map: Record<string, string>, r: { error: string; body?: unknown }) => {
    const detail = (r.body as { detail?: string } | undefined)?.detail;
    return `${map[r.error] ?? d.app.auth.errors.server_error}${detail && detail !== r.error ? `: ${detail}` : ""}`;
  };
  const ready = cfg.fields.every((x) => (form[x.key] ?? "").trim().length >= x.min);
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api(`/integrations/${cfg.provider}/connect`, { method: "POST", body: Object.fromEntries(cfg.fields.map((x) => [x.key, x.type === "password" ? form[x.key] ?? "" : (form[x.key] ?? "").trim()])) });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return show(errText(cfg.errors, r), "warn");
    }
    playSound("success");
    setForm({});
    reload();
  };
  const sync = async () => {
    setBusy(true);
    const r = await api<{ imported: number }>(`/integrations/${cfg.provider}/sync`, { method: "POST" });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      show(errText(t.syncErrors, r), "warn");
    } else {
      playSound("success");
      show(t.imported.replace("{n}", String(r.data.imported)));
    }
    reload();
  };
  const disconnect = async () => {
    await api(`/integrations/${cfg.provider}`, { method: "DELETE" });
    setConfirm(false);
    reload();
  };
  const name = t.names[cfg.provider];
  return (
    <Panel title={name} action={<span className="ok-muted">{connected ? t.connected : t.notConnected}</span>}>
      <p className="ok-muted">{cfg.about}</p>
      {!connected ? (
        <form className="grid gap-3" onSubmit={connect}>
          <ol className="ok-steps">{cfg.steps.map((x) => <li key={x}>{x}</li>)}</ol>
          <div className="grid gap-3 sm:grid-cols-2">
            {cfg.fields.map((x) => (
              <Field key={x.key} label={x.label}>
                {(p) => <input {...p} className="input" type={x.type ?? "text"} autoComplete={x.type === "password" ? "new-password" : "off"} spellCheck={false} maxLength={200} value={form[x.key] ?? ""} onChange={(e) => setForm({ ...form, [x.key]: e.target.value })} />}
              </Field>
            ))}
          </div>
          <button className="btn btn-sm" type="submit" disabled={busy || !ready} style={{ justifySelf: "start" }}>{busy ? t.checking : t.connect}</button>
        </form>
      ) : (
        <div className="grid gap-3">
          <p className="ok-muted">{t.lastSync}: {item.settings.lastSyncAt ? f.dateTime(new Date(item.settings.lastSyncAt).getTime()) : t.never}</p>
          {item.lastError && <p className="ok-note">{t.lastError}: {item.lastError}</p>}
          <div className="ok-actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={sync}>{busy ? t.syncing : t.syncNow}</button>
            {confirm ? (
              <>
                <span className="ok-muted">{t.confirmDisconnect}</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={disconnect}>{t.disconnect}</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirm(true)}>{t.disconnect}</button>
            )}
          </div>
        </div>
      )}
      {flash}
    </Panel>
  );
}

export function IntegrationsScreen({ embedded = false }: { embedded?: boolean }) {
  const t = useDict().app.integrations;
  const [items, setItems] = useState<Item[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<Item[]>("/integrations");
    if (r.ok) setItems(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!items) return null;
  const np = items.find((i) => i.provider === "novaposhta");
  const ukr = items.find((i) => i.provider === "ukrposhta");
  const prom = items.find((i) => i.provider === "prom");
  const rozetka = items.find((i) => i.provider === "rozetka");
  return (
    <div className="ok-screen">
      {!embedded && <div className="ok-h"><h3>{t.title}</h3></div>}
      <p className="ok-muted">{t.lead}</p>
      {np && <NovaPoshta item={np} key={np.status} reload={load} />}
      {ukr && <Ukrposhta item={ukr} key={`up-${ukr.status}`} reload={load} />}
      {prom && <Marketplace item={prom} key={`prom-${prom.status}`} reload={load} cfg={{ provider: "prom", about: t.promAbout, steps: t.promSteps, fields: [{ key: "token", label: t.promToken, min: 20 }], errors: t.promErrors }} />}
      {rozetka && <Marketplace item={rozetka} key={`rz-${rozetka.status}`} reload={load} cfg={{ provider: "rozetka", about: t.rozetkaAbout, steps: t.rozetkaSteps, fields: [{ key: "username", label: t.rozetkaLogin, min: 2 }, { key: "password", label: t.rozetkaPassword, type: "password", min: 1 }], errors: t.rozetkaErrors }} />}
      <Panel title={t.soon}>
        <ul className="ok-list">
          {items.filter((i) => !i.available).map((i) => (
            <li key={i.provider}><span className="ok-grow">{(t.names as Record<string, string>)[i.provider] ?? i.provider}</span><small className="ok-muted">{t.soon}</small></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
