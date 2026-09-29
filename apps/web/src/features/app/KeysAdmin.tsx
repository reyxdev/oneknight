"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { moduleCatalog } from "@/data/modules";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Batch = { batch: string; kind: "oneknight" | "module"; moduleId: string | null; months: number; activateBefore: string | null; note: string | null; createdAt: string; total: number; redeemed: number; disabled: number };
type Key = { id: string; hint: string; disabled: boolean; redeemedAt: string | null; org: string | null };
type Promo = { id: string; code: string; kind: "percent" | "bonus"; value: number; months: number; maxUses: number | null; uses: number; validUntil: string | null; active: boolean; note: string | null };

const LIVE = moduleCatalog.filter((m) => m.live).map((m) => m.id);

function BatchRow({ b, reload }: { b: Batch; reload: () => void }) {
  const d = useDict();
  const t = d.app.keysAdmin;
  const f = useFormat();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const loadKeys = useCallback(async () => {
    const r = await api<Key[]>(`/admin/keys/${b.batch}`);
    if (r.ok) setKeys(r.data);
  }, [b.batch]);
  const patch = async (id: string, disabled: boolean, wholeBatch = false) => {
    await api(`/admin/keys/${id}`, { method: "PATCH", body: { disabled, wholeBatch } });
    if (keys) void loadKeys();
    reload();
  };
  const del = async () => {
    await api(`/admin/keys/batch/${b.batch}`, { method: "DELETE" });
    setConfirm(false);
    reload();
  };
  const what = b.kind === "oneknight" ? t.kinds.oneknight : d.ok.modules.items[b.moduleId as keyof typeof d.ok.modules.items]?.name ?? b.moduleId;
  const unused = b.total - b.redeemed;
  return (
    <li className="app-batch">
      <div className="app-batch-head">
        <span className="ok-grow">
          <b>{what} · {b.months} {t.monthsShort}</b>
          <small>
            {f.date(new Date(b.createdAt).getTime())} · {fmt(t.stats, { t: b.total, r: b.redeemed, d: b.disabled })}
            {b.activateBefore ? ` · ${fmt(t.until, { date: f.date(new Date(b.activateBefore).getTime()) })}` : ""}
            {b.note ? ` · ${b.note}` : ""}
          </small>
        </span>
        <span className="ok-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => (keys ? setKeys(null) : void loadKeys())}>{keys ? t.hide : t.show}</button>
          {unused > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch(b.batch, true, true)}>{t.disableRest}</button>}
          {unused > 0 && (confirm ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={del}>{t.deleteRest}?</button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)} title={t.confirmDelete}>{t.deleteRest}</button>
          ))}
        </span>
      </div>
      {confirm && <p className="ok-muted">{t.confirmDelete}</p>}
      {keys && (
        <ul className="ok-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span className="num">…{k.hint}</span>
              <span className="ok-grow ok-muted">{k.redeemedAt ? fmt(t.redeemed, { org: k.org ?? "—" }) : k.disabled ? t.off : ""}</span>
              {!k.redeemedAt && <button type="button" className="ok-link" onClick={() => patch(k.id, !k.disabled)}>{k.disabled ? t.enable : t.disable}</button>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Keys() {
  const d = useDict();
  const t = d.app.keysAdmin;
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [kind, setKind] = useState<"oneknight" | "module">("oneknight");
  const [moduleId, setModuleId] = useState(LIVE[0] ?? "");
  const [months, setMonths] = useState("3");
  const [count, setCount] = useState("10");
  const [before, setBefore] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<Batch[]>("/admin/keys");
    if (r.ok) setBatches(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const generate = async (e: FormEvent) => {
    e.preventDefault();
    const body = { kind, ...(kind === "module" ? { moduleId } : {}), months: Number(months), count: Number(count), ...(before ? { activateBefore: before } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
    const r = await api<{ codes: string[] }>("/admin/keys", { method: "POST", body });
    if (!r.ok) {
      playSound("error");
      return setErr(t.errors.invalid_input);
    }
    playSound("success");
    setErr(null);
    setCodes(r.data.codes);
    void load();
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([codes!.join("\n") + "\n"], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `oneknight-keys-${new Date().toISOString().slice(0, 10)}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <Panel title={t.title}>
        <p className="ok-muted">{t.lead}</p>
        {codes ? (
          <div className="grid gap-3">
            <b>{t.fresh}</b>
            <textarea className="input app-codes" readOnly rows={Math.min(12, codes.length)} value={codes.join("\n")} aria-label={t.fresh} />
            <div className="ok-actions">
              <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(codes.join("\n")).catch(() => {})}>{t.copyAll}</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={download}>{t.download}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCodes(null)}>{t.done}</button>
            </div>
          </div>
        ) : (
          <form className="grid gap-3" onSubmit={generate} noValidate>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t.kind}>{(p) => <select {...p} className="input" value={kind} onChange={(e) => setKind(e.target.value as "oneknight" | "module")}><option value="oneknight">{t.kinds.oneknight}</option><option value="module">{t.kinds.module}</option></select>}</Field>
              {kind === "module" && <Field label={t.module}>{(p) => <select {...p} className="input" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>{LIVE.map((m) => <option key={m} value={m}>{d.ok.modules.items[m].name}</option>)}</select>}</Field>}
              <Field label={t.months}>{(p) => <input {...p} className="input" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))} />}</Field>
              <Field label={t.count}>{(p) => <input {...p} className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />}</Field>
              <Field label={t.activateBefore}>{(p) => <input {...p} className="input" type="date" value={before} onChange={(e) => setBefore(e.target.value)} />}</Field>
              <Field label={t.note}>{(p) => <input {...p} className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            </div>
            {err && <p className="ok-note" role="alert">{err}</p>}
            <button className="btn btn-sm" type="submit" style={{ justifySelf: "start" }}>{t.generate}</button>
          </form>
        )}
      </Panel>
      <Panel title={t.batches}>
        {batches && batches.length === 0 ? <p className="ok-muted">{t.empty}</p> : <ul className="app-batches">{(batches ?? []).map((b) => <BatchRow key={b.batch} b={b} reload={load} />)}</ul>}
      </Panel>
    </>
  );
}

function Promos() {
  const t = useDict().app.keysAdmin;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [rows, setRows] = useState<Promo[] | null>(null);
  const [form, setForm] = useState({ code: "", kind: "percent" as Promo["kind"], value: "10", months: "1", maxUses: "", validUntil: "" });
  const load = useCallback(async () => {
    const r = await api<Promo[]>("/admin/promos");
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const body = { code: form.code, kind: form.kind, value: Number(form.value), months: Number(form.months) || 1, ...(form.maxUses ? { maxUses: Number(form.maxUses) } : {}), ...(form.validUntil ? { validUntil: form.validUntil } : {}) };
    const r = await api("/admin/promos", { method: "POST", body });
    if (!r.ok) {
      playSound("error");
      return show((t.errors as Record<string, string>)[r.error] ?? t.errors.invalid_input, "warn");
    }
    playSound("success");
    setForm({ ...form, code: "" });
    void load();
  };
  const toggle = async (p: Promo) => {
    await api(`/admin/promos/${p.id}`, { method: "PATCH", body: { active: !p.active } });
    void load();
  };
  const del = async (p: Promo) => {
    const r = await api(`/admin/promos/${p.id}`, { method: "DELETE" });
    if (!r.ok) show((t.errors as Record<string, string>)[r.error] ?? t.errors.invalid_input, "warn");
    void load();
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: k === "code" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") : e.target.value });
  return (
    <Panel title={t.promoTitle}>
      <p className="ok-muted">{t.promoLead}</p>
      <form className="grid gap-3" onSubmit={create} noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t.code}>{(p) => <input {...p} className="input" maxLength={32} value={form.code} onChange={set("code")} />}</Field>
          <Field label={t.promoKind}>{(p) => <select {...p} className="input" value={form.kind} onChange={set("kind")}><option value="percent">{t.promoKinds.percent}</option><option value="bonus">{t.promoKinds.bonus}</option></select>}</Field>
          <Field label={t.value}>{(p) => <input {...p} className="input" inputMode="numeric" value={form.value} onChange={set("value")} />}</Field>
          {form.kind === "percent" && <Field label={t.promoMonths}>{(p) => <input {...p} className="input" inputMode="numeric" value={form.months} onChange={set("months")} />}</Field>}
          <Field label={t.maxUses}>{(p) => <input {...p} className="input" inputMode="numeric" value={form.maxUses} onChange={set("maxUses")} />}</Field>
          <Field label={t.validUntil}>{(p) => <input {...p} className="input" type="date" value={form.validUntil} onChange={set("validUntil")} />}</Field>
        </div>
        <button className="btn btn-sm" type="submit" disabled={form.code.length < 3} style={{ justifySelf: "start" }}>{t.createPromo}</button>
      </form>
      {rows && rows.length === 0 ? (
        <p className="ok-muted">{t.promoEmpty}</p>
      ) : (
        <ul className="ok-list">
          {(rows ?? []).map((p) => (
            <li key={p.id}>
              <span className="ok-grow">
                <b className="num">{p.code}</b>
                <small>
                  {p.kind === "percent" ? `−${p.value}% × ${p.months}` : `+${p.value} ₴`} · {fmt(t.uses, { u: p.uses, m: p.maxUses ? ` / ${p.maxUses}` : "" })}
                  {p.validUntil ? ` · ${f.date(new Date(p.validUntil).getTime())}` : ""}
                  {!p.active ? ` · ${t.off}` : ""}
                </small>
              </span>
              <button type="button" className="ok-link" onClick={() => toggle(p)}>{p.active ? t.disable : t.enable}</button>
              {p.uses === 0 && <button type="button" className="ok-link" onClick={() => del(p)}>{t.del}</button>}
            </li>
          ))}
        </ul>
      )}
      {flash}
    </Panel>
  );
}

/** Admin: access keys (ONEKNIGHT / modules) and promo codes. */
export function KeysAdmin() {
  const t = useDict().app.keysAdmin;
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.nav}</h3></div>
      <Keys />
      <Promos />
    </div>
  );
}
