"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";
import { estimateSite, type CalculatorConfig } from "@oneknight/domain";
import { formatUAH } from "@/data/pricing";
import { useToast } from "./Toasts";

const TYPES = ["card", "service", "shop", "corporate"] as const;

/** Admin: the numbers of the website calculator on oneknight.pro (owner's decision H25). */
function CalculatorAdmin() {
  const d = useDict();
  const t = d.app.siteAdmin;
  const toast = useToast();
  const [c, setC] = useState<CalculatorConfig | null>(null);
  useEffect(() => {
    void api<CalculatorConfig>("/admin/site/calculator").then((r) => r.ok && setC(r.data));
  }, []);
  if (!c) return null;
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const example = estimateSite(c, { siteType: "shop", products: c.products[1] ? String(c.products[1].max ?? "more") : "more", design: "custom", languages: 2, content: 20 });
  return (
    <Panel title={t.calculator}>
      <p className="ok-muted">{t.calculatorLead}</p>
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); const r = await api<CalculatorConfig>("/admin/site/calculator", { method: "PUT", body: c }); toast.show(r.ok ? t.saved : t.invalid, r.ok ? "ok" : "warn"); }}>
        <div className="app-ch-counts">
          {TYPES.map((k) => <Field key={k} label={`${d.siteTypes[k]}, ${t.uah}`}>{(p) => <input {...p} className="input" type="number" min={0} value={c.base[k]} onChange={(e) => setC({ ...c, base: { ...c.base, [k]: num(e.target.value) } })} />}</Field>)}
        </div>
        <fieldset className="app-q">
          <legend>{t.tiers}</legend>
          {c.products.map((x, i) => (
            <div key={i} className="app-pay-row">
              <input className="input" type="number" min={1} aria-label={t.tierMax} placeholder={t.tierMore} value={x.max ?? ""} onChange={(e) => setC({ ...c, products: c.products.map((y, j) => (j === i ? { ...y, max: e.target.value ? num(e.target.value) : null } : y)) })} />
              <input className="input" type="number" min={0} aria-label={t.tierAdd} value={x.add} onChange={(e) => setC({ ...c, products: c.products.map((y, j) => (j === i ? { ...y, add: num(e.target.value) } : y)) })} />
            </div>
          ))}
          <p className="ok-muted">{t.tiersHint}</p>
        </fieldset>
        <div className="app-ch-counts">
          <Field label={t.design}>{(p) => <input {...p} className="input" type="number" min={0} value={c.customDesignPct} onChange={(e) => setC({ ...c, customDesignPct: num(e.target.value) })} />}</Field>
          <Field label={t.language}>{(p) => <input {...p} className="input" type="number" min={0} value={c.languagePct} onChange={(e) => setC({ ...c, languagePct: num(e.target.value) })} />}</Field>
          <Field label={t.contentPer10}>{(p) => <input {...p} className="input" type="number" min={0} value={c.contentPer10} onChange={(e) => setC({ ...c, contentPer10: num(e.target.value) })} />}</Field>
          <Field label={t.contentMax}>{(p) => <input {...p} className="input" type="number" min={0} value={c.contentMax} onChange={(e) => setC({ ...c, contentMax: num(e.target.value) })} />}</Field>
          <Field label={t.spread}>{(p) => <input {...p} className="input" type="number" min={0} value={c.spreadPct} onChange={(e) => setC({ ...c, spreadPct: num(e.target.value) })} />}</Field>
        </div>
        <p className="ok-muted">{t.example} <b className="num">{formatUAH(example.from, "uk")} — {formatUAH(example.to, "uk")}</b></p>
        <button type="submit" className="btn btn-sm" style={{ justifySelf: "start" }}>{t.save}</button>
      </form>
    </Panel>
  );
}

type Incident = { id: string; service: string; startedAt: string; endedAt: string | null; note: string | null };

/** Admin: incidents of the status page, each with the owner's explanation shown on /status. */
function IncidentsAdmin() {
  const d = useDict();
  const t = d.app.siteAdmin;
  const f = useFormat();
  const toast = useToast();
  const [list, setList] = useState<Incident[] | null>(null);
  useEffect(() => {
    void api<Incident[]>("/admin/site/incidents").then((r) => r.ok && setList(r.data));
  }, []);
  if (!list) return null;
  return (
    <Panel title={t.incidents} action={<a className="ok-link" href="/status/" target="_blank" rel="noopener">{t.openStatus}</a>}>
      {list.length === 0 ? (
        <p className="ok-muted">{t.noIncidents}</p>
      ) : (
        <ul className="ok-list">
          {list.map((i) => (
            <li key={i.id} className="app-incident">
              <span className="app-cell-main">
                <b>{(d.statusPage.services as Record<string, string>)[i.service] ?? i.service}</b>
                <small>{f.dateTime(new Date(i.startedAt).getTime())} — {i.endedAt ? f.dateTime(new Date(i.endedAt).getTime()) : d.statusPage.ongoing}</small>
              </span>
              <textarea className="input" rows={2} aria-label={t.note} placeholder={t.noteHint} defaultValue={i.note ?? ""} onBlur={async (e) => { const v = e.target.value.trim(); if (v === (i.note ?? "")) return; const r = await api(`/admin/site/incidents/${i.id}`, { method: "PATCH", body: { note: v || null } }); toast.show(r.ok ? t.noteSaved : t.invalid, r.ok ? "ok" : "warn"); }} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Admin «Комунікації → Сайт ONEKNIGHT»: what the public site shows. */
export function SiteAdmin() {
  return (
    <div className="grid gap-4">
      <CalculatorAdmin />
      <IncidentsAdmin />
    </div>
  );
}
