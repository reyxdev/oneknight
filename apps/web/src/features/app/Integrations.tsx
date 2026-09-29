"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api, latestOnly } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Item = { provider: string; available: boolean; status: string; settings: NpSettings & PromSettings; lastError: string | null; connectedAt: string | null };
type PromSettings = { lastSyncAt?: string };
type NpSettings = { cityRef?: string; cityName?: string; warehouseRef?: string; warehouseName?: string; weight?: number; description?: string };
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
export function NpPicker({ labels, value, onChange, initialCities = [], initialWarehouses = [] }: { labels: { city: string; branch: string }; value: NpPick; onChange: (v: NpPick) => void; initialCities?: NpCity[]; initialWarehouses?: NpWarehouse[] }) {
  const t = useDict().app.integrations;
  const cityPath = useCallback((q: string) => (q.trim().length >= 2 ? `/integrations/novaposhta/cities?q=${encodeURIComponent(q.trim())}` : null), []);
  const cityRef = value.city?.ref;
  const whPath = useCallback((q: string) => (cityRef ? `/integrations/novaposhta/warehouses?city=${cityRef}&q=${encodeURIComponent(q.trim())}` : null), [cityRef]);
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

function NovaPoshta({ item, reload }: { item: Item; reload: () => void }) {
  const d = useDict();
  const t = d.app.integrations;
  const [flash, show] = useFlash();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const s = item.settings;
  const [pick, setPick] = useState<NpPick>({
    city: s.cityRef ? { ref: s.cityRef, name: s.cityName ?? "", area: "" } : null,
    warehouse: s.warehouseRef ? { ref: s.warehouseRef, name: s.warehouseName ?? "", number: "" } : null,
  });
  const [weight, setWeight] = useState(String(s.weight ?? 1));
  const [desc, setDesc] = useState(s.description ?? "");
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
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick.city || !pick.warehouse) return show(t.needSettings, "warn");
    const r = await api("/integrations/novaposhta/settings", { method: "PATCH", body: { cityRef: pick.city.ref, cityName: pick.city.name, warehouseRef: pick.warehouse.ref, warehouseName: pick.warehouse.name, weight: Number(weight.replace(",", ".")) || 1, ...(desc.trim() ? { description: desc.trim() } : {}) } });
    if (!r.ok) return playSound("error");
    playSound("success");
    show(t.saved);
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
        <form className="grid gap-3" onSubmit={save}>
          {!s.warehouseRef && <p className="ok-note">{t.needSettings}</p>}
          <NpPicker labels={{ city: t.senderCity, branch: t.senderBranch }} value={pick} onChange={setPick} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.weight}>{(p) => <input {...p} className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />}</Field>
            <Field label={t.description}>{(p) => <input {...p} className="input" maxLength={100} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
          </div>
          {item.lastError && <p className="ok-note">{t.lastError}: {item.lastError}</p>}
          <div className="ok-actions">
            <button className="btn btn-sm" type="submit">{t.saveSettings}</button>
            {confirm ? (
              <>
                <span className="ok-muted">{t.confirmDisconnect}</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={disconnect}>{t.disconnect}</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirm(true)}>{t.disconnect}</button>
            )}
          </div>
        </form>
      )}
      {flash}
    </Panel>
  );
}

function Prom({ item, reload }: { item: Item; reload: () => void }) {
  const d = useDict();
  const t = d.app.integrations;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connected = item.status !== "not_connected";
  const errText = (map: Record<string, string>, r: { error: string; body?: unknown }) => {
    const detail = (r.body as { detail?: string } | undefined)?.detail;
    return `${map[r.error] ?? d.app.auth.errors.server_error}${detail && detail !== r.error ? `: ${detail}` : ""}`;
  };
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api("/integrations/prom/connect", { method: "POST", body: { token: token.trim() } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return show(errText(t.promErrors, r), "warn");
    }
    playSound("success");
    setToken("");
    reload();
  };
  const sync = async () => {
    setBusy(true);
    const r = await api<{ imported: number }>("/integrations/prom/sync", { method: "POST" });
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
    await api("/integrations/prom", { method: "DELETE" });
    setConfirm(false);
    reload();
  };
  return (
    <Panel title={t.names.prom} action={<span className="ok-muted">{connected ? t.connected : t.notConnected}</span>}>
      <p className="ok-muted">{t.promAbout}</p>
      {!connected ? (
        <form className="grid gap-3" onSubmit={connect}>
          <ol className="ok-steps">{t.promSteps.map((x) => <li key={x}>{x}</li>)}</ol>
          <Field label={t.promToken}>{(p) => <input {...p} className="input" autoComplete="off" spellCheck={false} maxLength={128} value={token} onChange={(e) => setToken(e.target.value)} />}</Field>
          <button className="btn btn-sm" type="submit" disabled={busy || token.trim().length < 20} style={{ justifySelf: "start" }}>{busy ? t.checking : t.connect}</button>
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

export function IntegrationsScreen() {
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
  const prom = items.find((i) => i.provider === "prom");
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <p className="ok-muted">{t.lead}</p>
      {np && <NovaPoshta item={np} key={np.status} reload={load} />}
      {prom && <Prom item={prom} key={prom.status} reload={load} />}
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
