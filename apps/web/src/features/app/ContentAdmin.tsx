"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";
import { useToast } from "./Toasts";

const BUCKETS = ["sale", "benefit", "trust", "fun"] as const;
type Template = { id: string; key: string; bucket: (typeof BUCKETS)[number]; trigger: string; categories: string[]; title: string; why: string; shot: string; short: string; long: string; cta: string; hashtags: string[]; hooks: string[]; stories: { text: string; sticker: string }[]; slides: { heading: string; photo: string }[]; article: { topic: string; outline: string[] } | null; light: boolean; active: boolean };
type Holiday = { id: string; key: string; name: string; rule: string; kind: "sale" | "greeting" | "respect"; prepDays: number; active: boolean; next: string | null };
type Draft = Pick<Template, "bucket" | "trigger" | "title" | "why" | "shot" | "short" | "long" | "cta" | "light"> & { hashtags: string };
const draftOf = (t?: Template): Draft => ({ bucket: t?.bucket ?? "sale", trigger: t?.trigger ?? "evergreen", title: t?.title ?? "", why: t?.why ?? "", shot: t?.shot ?? "", short: t?.short ?? "", long: t?.long ?? "", cta: t?.cta ?? "", light: t?.light ?? false, hashtags: (t?.hashtags ?? []).join(" ") });

function TemplateForm({ template, triggers, onSaved, onCancel }: { template: Template | null; triggers: string[]; onSaved: () => void; onCancel: () => void }) {
  const d = useDict();
  const t = d.app.contentAdmin;
  const c = d.app.content;
  const toast = useToast();
  const [f, setF] = useState(draftOf(template ?? undefined));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF({ ...f, [k]: v });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, hashtags: f.hashtags.split(/[\s,#]+/).filter(Boolean) };
    const r = template
      ? await api(`/admin/content/templates/${template.id}`, { method: "PATCH", body })
      : await api("/admin/content/templates", { method: "POST", body: { ...body, categories: [], hooks: [], stories: [], slides: [], article: null, active: true } });
    if (!r.ok) return toast.show(t.invalid, "warn");
    toast.show(t.saved);
    onSaved();
  };
  const area = (k: "why" | "shot" | "short" | "long", label: string, rows: number) => <Field label={label}>{(p) => <textarea {...p} className="input" rows={rows} value={f[k]} onChange={(e) => set(k, e.target.value)} />}</Field>;
  return (
    <form className="grid gap-3" onSubmit={save}>
      {!template && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.bucket}>{(p) => <select {...p} className="input" value={f.bucket} onChange={(e) => set("bucket", e.target.value as Draft["bucket"])}>{BUCKETS.map((b) => <option key={b} value={b}>{c.buckets[b]}</option>)}</select>}</Field>
          <Field label={t.trigger}>{(p) => <select {...p} className="input" value={f.trigger} onChange={(e) => set("trigger", e.target.value)}>{triggers.map((x) => <option key={x} value={x}>{(t.triggers as Record<string, string>)[x] ?? x}</option>)}</select>}</Field>
        </div>
      )}
      <Field label={t.titleField}>{(p) => <input {...p} className="input" maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} />}</Field>
      {area("why", c.why, 2)}
      {area("shot", c.shot, 2)}
      {area("short", c.variantShort, 3)}
      {area("long", c.variantLong, 7)}
      <Field label={c.cta}>{(p) => <input {...p} className="input" maxLength={200} value={f.cta} onChange={(e) => set("cta", e.target.value)} />}</Field>
      <Field label={t.hashtags}>{(p) => <input {...p} className="input" value={f.hashtags} onChange={(e) => set("hashtags", e.target.value)} />}</Field>
      <Toggle checked={f.light} onChange={(v) => set("light", v)} label={t.light} />
      <p className="ok-muted">{t.placeholders}</p>
      <div className="ok-actions">
        <button type="submit" className="btn btn-sm">{t.save}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>{c.cancel}</button>
      </div>
    </form>
  );
}

function Templates() {
  const d = useDict();
  const t = d.app.contentAdmin;
  const c = d.app.content;
  const toast = useToast();
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number] | "">("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ templates: Template[]; counts: Record<string, number>; triggers: string[] } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams({ ...(bucket ? { bucket } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
    const r = await api<{ templates: Template[]; counts: Record<string, number>; triggers: string[] }>(`/admin/content/templates?${p}`);
    if (r.ok) setData(r.data);
  }, [bucket, q]);
  useEffect(() => {
    const id = setTimeout(() => void load(), 250);
    return () => clearTimeout(id);
  }, [load]);
  if (!data) return null;
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  return (
    <Panel title={t.templates} action={<button type="button" className="btn btn-sm" onClick={() => setEdit("new")}><Icon name="plus" size={15} />{t.add}</button>}>
      <p className="ok-muted">{fmt(t.counts, { n: total, sale: data.counts.sale ?? 0, benefit: data.counts.benefit ?? 0, trust: data.counts.trust ?? 0, fun: data.counts.fun ?? 0 })}</p>
      <div className="ok-chips">
        <button type="button" className="ok-chip" aria-pressed={bucket === ""} onClick={() => setBucket("")}>{t.all}</button>
        {BUCKETS.map((b) => <button key={b} type="button" className="ok-chip" aria-pressed={bucket === b} onClick={() => setBucket(b)}>{c.buckets[b]}</button>)}
        <input className="input" type="search" aria-label={t.search} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      {edit === "new" && <TemplateForm template={null} triggers={data.triggers} onSaved={() => { setEdit(null); void load(); }} onCancel={() => setEdit(null)} />}
      <ul className="ok-list">
        {data.templates.map((x) => (
          <li key={x.id} data-off={!x.active || undefined}>
            {edit === x.id ? (
              <div className="ok-grow"><TemplateForm template={x} triggers={data.triggers} onSaved={() => { setEdit(null); void load(); }} onCancel={() => setEdit(null)} /></div>
            ) : (
              <>
                <span className="ok-grow app-cell-main">
                  <b>{x.title}</b>
                  <small>{c.buckets[x.bucket]} · {(t.triggers as Record<string, string>)[x.trigger] ?? x.trigger}{x.light ? ` · ${t.lightShort}` : ""}{x.categories.length ? ` · ${x.categories.join(", ")}` : ""} · {x.short.slice(0, 90)}…</small>
                </span>
                <button type="button" className="ok-link" onClick={() => setEdit(x.id)}>{t.edit}</button>
                <Toggle checked={x.active} onChange={async (v) => { const r = await api(`/admin/content/templates/${x.id}`, { method: "PATCH", body: { active: v } }); if (r.ok) void load(); else toast.show(t.invalid, "warn"); }} label={t.active} />
              </>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Holidays() {
  const d = useDict();
  const t = d.app.contentAdmin;
  const f = useFormat();
  const toast = useToast();
  const [list, setList] = useState<Holiday[]>([]);
  const [form, setForm] = useState({ name: "", rule: "fixed:", kind: "greeting" as Holiday["kind"], prepDays: "2" });
  const load = useCallback(async () => {
    const r = await api<Holiday[]>("/admin/content/holidays");
    if (r.ok) setList(r.data.sort((a, b) => (a.next ?? "").slice(5).localeCompare((b.next ?? "").slice(5))));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const patch = async (id: string, body: object) => {
    const r = await api(`/admin/content/holidays/${id}`, { method: "PATCH", body });
    if (!r.ok) toast.show(t.invalid, "warn");
    void load();
  };
  return (
    <Panel title={t.holidays}>
      <p className="ok-muted">{t.holidaysLead}</p>
      <ul className="ok-list">
        {list.map((h) => (
          <li key={h.id} data-off={!h.active || undefined}>
            <span className="ok-grow app-cell-main"><b>{h.name}</b><small>{h.next ? f.date(new Date(h.next).getTime()) : h.rule} · {t.kinds[h.kind]}</small></span>
            <label className="app-inline">
              {t.prep}
              <input className="input" type="number" min={0} max={30} defaultValue={h.prepDays} style={{ width: 70 }} onBlur={(e) => Number(e.target.value) !== h.prepDays && patch(h.id, { prepDays: Number(e.target.value) })} />
            </label>
            <Toggle checked={h.active} onChange={(v) => patch(h.id, { active: v })} label={t.active} />
          </li>
        ))}
      </ul>
      <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await api("/admin/content/holidays", { method: "POST", body: { ...form, prepDays: Number(form.prepDays), active: true } }); if (!r.ok) return toast.show(t.invalid, "warn"); setForm({ name: "", rule: "fixed:", kind: "greeting", prepDays: "2" }); void load(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.holidayName}>{(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label={t.rule} hint={t.ruleHint}>{(p) => <input {...p} className="input" value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })} />}</Field>
          <Field label={t.kind}>{(p) => <select {...p} className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Holiday["kind"] })}>{(["sale", "greeting", "respect"] as const).map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}</select>}</Field>
          <Field label={t.prep}>{(p) => <input {...p} className="input" type="number" min={0} max={30} value={form.prepDays} onChange={(e) => setForm({ ...form, prepDays: e.target.value })} />}</Field>
        </div>
        <button type="submit" className="btn btn-sm" style={{ justifySelf: "start" }} disabled={form.name.trim().length < 2}>{t.addHoliday}</button>
      </form>
    </Panel>
  );
}

/** Admin «Контент-план»: the starter idea templates and the holidays of the calendar. */
export function ContentAdmin() {
  return (
    <div className="grid gap-4">
      <Templates />
      <Holidays />
    </div>
  );
}
