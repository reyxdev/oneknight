"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash } from "@/features/oneknight/ui/kit";
import { GROUPS, useOrderSettings, type Group } from "./Orders";

/** A list of short texts: add, remove (own cancel reasons, own sources of manual orders). */
function Words({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (v: string[]) => void }) {
  const t = useDict().app.businessOrders;
  const [v, setV] = useState("");
  const add = () => {
    const x = v.trim();
    if (x && !items.includes(x)) onChange([...items, x]);
    setV("");
  };
  return (
    <div className="grid gap-2">
      <div className="ok-chips">
        {items.map((x) => (
          <span key={x} className="ok-chip app-word">{x}<button type="button" aria-label={`${t.remove}: ${x}`} onClick={() => onChange(items.filter((y) => y !== x))}><Icon name="close" size={12} /></button></span>
        ))}
      </div>
      <div className="ok-form-row">
        <Field label={label} hint={hint}>{(p) => <input {...p} className="input" maxLength={100} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />}</Field>
        <span />
        <button type="button" className="btn btn-sm btn-secondary" disabled={!v.trim()} onClick={add}>{t.add}</button>
      </div>
    </div>
  );
}

/** «Бізнес → Замовлення»: own statuses inside groups, cancel reasons, sources, hours until a new order is urgent. */
export function BusinessOrders() {
  const d = useDict();
  const t = d.app.businessOrders;
  const [flash, show] = useFlash();
  const { settings, reload } = useOrderSettings();
  const [name, setName] = useState("");
  const [group, setGroup] = useState<Group>("confirmed");
  const [f, setF] = useState<{ reasons: string[]; sources: string[]; urgentHours: string } | null>(null);
  useEffect(() => {
    if (settings && !f) setF({ reasons: settings.reasons, sources: settings.sources, urgentHours: String(settings.urgentHours) });
  }, [settings, f]);
  if (!settings || !f) return null;

  const addStatus = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api("/shop/settings/statuses", { method: "POST", body: { name: name.trim(), group } });
    if (!r.ok) return playSound("error");
    playSound("success");
    setName("");
    void reload();
  };
  const rename = async (id: string, value: string) => {
    if (!value.trim()) return;
    await api(`/shop/settings/statuses/${id}`, { method: "PATCH", body: { name: value.trim() } });
    void reload();
  };
  const remove = async (id: string) => {
    await api(`/shop/settings/statuses/${id}`, { method: "DELETE" });
    void reload();
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api("/shop/settings", { method: "PUT", body: { reasons: f.reasons, sources: f.sources, urgentHours: Math.max(1, Math.min(72, Number(f.urgentHours) || 2)) } });
    if (!r.ok) return playSound("error");
    playSound("success");
    show(t.saved);
    void reload();
  };

  return (
    <>
      <Panel title={t.statusesTitle}>
        <p className="ok-muted">{t.statusesLead}</p>
        <ul className="app-status-groups">
          {GROUPS.map((g) => (
            <li key={g}>
              <span className="ok-pill" data-s={g}>{d.ok.orders.status[g]}</span>
              <ul>
                {settings.statuses.filter((s) => s.group === g).map((s) => (
                  <li key={s.id}>
                    <input className="input input-sm" aria-label={t.statusName} defaultValue={s.name} maxLength={40} onBlur={(e) => e.target.value !== s.name && rename(s.id, e.target.value)} />
                    <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={`${t.remove}: ${s.name}`} onClick={() => remove(s.id)}><Icon name="trash" size={15} /></button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <form className="ok-form-row" onSubmit={addStatus}>
          <Field label={t.statusName}>{(p) => <input {...p} className="input" maxLength={40} placeholder={t.statusExample} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t.statusGroup}>
            {(p) => (
              <select {...p} className="input" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
                {GROUPS.map((g) => <option key={g} value={g}>{d.ok.orders.status[g]}</option>)}
              </select>
            )}
          </Field>
          <button type="submit" className="btn btn-sm" disabled={!name.trim()}>{t.addStatus}</button>
        </form>
      </Panel>
      <Panel title={t.otherTitle}>
        <form className="grid gap-4" onSubmit={save}>
          <Words label={t.reason} hint={t.reasonsHint} items={f.reasons} onChange={(reasons) => setF({ ...f, reasons })} />
          <Words label={t.source} hint={t.sourcesHint} items={f.sources} onChange={(sources) => setF({ ...f, sources })} />
          <Field label={t.urgent} hint={t.urgentHint}>{(p) => <input {...p} className="input" inputMode="numeric" style={{ maxWidth: "8rem" }} value={f.urgentHours} onChange={(e) => setF({ ...f, urgentHours: e.target.value.replace(/\D/g, "").slice(0, 2) })} />}</Field>
          <button className="btn btn-sm" type="submit" style={{ justifySelf: "start" }}>{t.save}</button>
        </form>
        {flash}
      </Panel>
    </>
  );
}
