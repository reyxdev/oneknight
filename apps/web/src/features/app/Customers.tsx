"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api, latestOnly } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Empty, Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";
import { useToast } from "./Toasts";
import { PAGE, Table, useEscClose, type Col, type Sort } from "./Table";
import { StatusBadge, useOrderSettings, type Group } from "./Orders";

export type CustomerTag = { id: string; name: string; color: string };
export type CustomerSettings = { tags: CustomerTag[]; sleepDays: number; canEdit: boolean };
const SEGMENTS = ["all", "new", "regular", "sleeping", "top", "risky"] as const;
type Segment = (typeof SEGMENTS)[number];
const PRESETS = ["vip", "wholesale"] as const;

type Row = { id: string; name: string; phone: string | null; email: string | null; company: string | null; tags: string[]; auto: string[]; city: string | null; firstSource: string | null; anonymized: boolean; createdAt: string; orders: number; sumKop: number | null; lastAt: string | null };
type Card = Omit<Row, "orders" | "sumKop" | "lastAt" | "city" | "anonymized"> & {
  edrpou: string | null;
  anonymizedAt: string | null;
  delivery: { method: string; city?: string; branch?: string; address?: string } | null;
  stats: { orders: number; sumKop: number | null; lastAt: string | null; done: number; returned: number; cancelled: number };
  orders: { id: string; number: number; status: Group; statusId: string | null; totalKop: number | null; createdAt: string; source: string }[];
  notes: { id: string; text: string; at: string; by: string | null }[];
};

export function useCustomerSettings() {
  const [s, setS] = useState<CustomerSettings | null>(null);
  const load = useCallback(async () => {
    const r = await api<CustomerSettings>("/customers/settings");
    if (r.ok) setS(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { settings: s, reload: load };
}

/** A tag chip: presets and counted ones have fixed colours, the business's own ones their colour. */
export function TagChip({ id, settings }: { id: string; settings: CustomerSettings | null }) {
  const t = useDict().app.customers;
  const own = settings?.tags.find((x) => x.id === id);
  const name = own?.name ?? (t.tags as Record<string, string>)[id] ?? id;
  return (
    <span className="app-tag" data-tag={own ? undefined : id} style={own ? { ["--tag" as string]: own.color } : undefined}>
      {name}
    </span>
  );
}

/** Call, Viber, Telegram, WhatsApp, copy — next to the phone. */
export function ContactButtons({ phone }: { phone: string }) {
  const t = useDict().app.customers;
  const toast = useToast();
  const d = phone.replace(/\D/g, "");
  const intl = d.length === 10 && d.startsWith("0") ? `38${d}` : d;
  return (
    <span className="app-contact">
      <a className="btn btn-sm btn-secondary" href={`tel:+${intl}`}><Icon name="phone" size={14} />{t.call}</a>
      <a className="btn btn-sm btn-ghost" href={`viber://chat?number=%2B${intl}`}>Viber</a>
      <a className="btn btn-sm btn-ghost" href={`https://t.me/+${intl}`} target="_blank" rel="noopener">Telegram</a>
      <a className="btn btn-sm btn-ghost" href={`https://wa.me/${intl}`} target="_blank" rel="noopener">WhatsApp</a>
      <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(`+${intl}`); toast.show(t.copied); } catch { toast.show(`+${intl}`); } }}>{t.copy}</button>
    </span>
  );
}

function CustomerCard({ id, settings, finance, onChanged, onClose, go }: { id: string; settings: CustomerSettings | null; finance: boolean; onChanged: () => void; onClose: () => void; go: (screen: string, tab?: string) => void }) {
  const d = useDict();
  const t = d.app.customers;
  const lang = useLang();
  const f = useFormat();
  const [flash, show] = useFlash();
  const { settings: orderSettings } = useOrderSettings();
  const [c, setC] = useState<Card | null>(null);
  const [edit, setEdit] = useState<{ name: string; email: string; company: string; edrpou: string } | null>(null);
  const [note, setNote] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeQ, setMergeQ] = useState("");
  const [mergeFound, setMergeFound] = useState<Row[]>([]);
  const [anon, setAnon] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (mergeQ.trim().length < 2) return setMergeFound([]);
    const timer = setTimeout(async () => {
      const r = await api<Row[]>(`/customers?q=${encodeURIComponent(mergeQ.trim())}&limit=8`);
      if (r.ok) setMergeFound(r.data.filter((x) => x.id !== id && !x.anonymized));
    }, 200);
    return () => clearTimeout(timer);
  }, [mergeQ, id]);
  const load = useCallback(async () => {
    const r = await api<Card>(`/customers/${id}`);
    if (r.ok) setC(r.data);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!c) return null;
  const patch = async (body: object) => {
    const r = await api(`/customers/${id}`, { method: "PATCH", body });
    if (!r.ok) {
      playSound("error");
      return show(t.invalid, "warn");
    }
    playSound("success");
    show(t.saved);
    void load();
    onChanged();
  };
  const toggleTag = (tag: string) => patch({ tags: c.tags.includes(tag) ? c.tags.filter((x) => x !== tag) : [...c.tags, tag] });
  const anonymized = !!c.anonymizedAt;
  // One line: orders and notes by date.
  const line: { at: string; order?: Card["orders"][number]; note?: Card["notes"][number] }[] = [...c.orders.map((o) => ({ at: o.createdAt, order: o })), ...c.notes.map((n) => ({ at: n.at, note: n }))].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Panel className="ok-detail" title={c.name} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <div className="app-order-top">
        {[...c.auto, ...c.tags].map((x) => <TagChip key={x} id={x} settings={settings} />)}
        {finance && c.stats.sumKop !== null && <b className="num app-secret">{formatUAH(c.stats.sumKop / 100, lang)}</b>}
        <span className="ok-muted">{fmt(t.ordersCount, { n: c.stats.orders })}</span>
      </div>
      {c.auto.includes("problem") && <p className="ok-note app-warn">{t.problemAdvice}</p>}
      {anonymized && <p className="ok-note">{t.anonymizedNote}</p>}
      {c.phone && !anonymized && <ContactButtons phone={c.phone} />}
      {!anonymized && (
        <div className="ok-actions">
          <button type="button" className="btn btn-sm" onClick={() => go("orders", `new-order:${c.id}`)}><Icon name="plus" size={14} />{t.newOrder}</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEdit({ name: c.name, email: c.email ?? "", company: c.company ?? "", edrpou: c.edrpou ?? "" })}>{t.edit}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMerging(true)}>{t.merge}</button>
          {settings?.canEdit && <button type="button" className="btn btn-sm btn-ghost ok-danger" onClick={() => setAnon(true)}>{t.anonymize}</button>}
        </div>
      )}
      <Modal open={merging} onClose={() => { setMerging(false); setMergeQ(""); }} labelledBy="ok-merge">
        <div className="app-dialog grid gap-3">
          <h2 id="ok-merge" className="app-neworders-title">{fmt(t.mergeTitle, { name: c.name })}</h2>
          <p className="ok-muted">{t.mergeLead}</p>
          <Field label={t.search}>{(p) => <input {...p} className="input" autoFocus value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} />}</Field>
          <ul className="app-picker-list app-inline">
            {mergeFound.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={async () => { const r = await api(`/customers/${id}/merge`, { method: "POST", body: { other: x.id } }); setMerging(false); setMergeQ(""); if (r.ok) { toast.show(fmt(t.merged, { name: x.name })); void load(); onChanged(); } else toast.show(d.app.auth.errors.server_error, "warn"); }}>
                  <span className="ok-grow">{x.name}</span><span className="num ok-muted">{x.phone}</span><small className="ok-muted">{fmt(t.ordersCount, { n: x.orders })}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
      <Modal open={anon} onClose={() => setAnon(false)} labelledBy="ok-anon">
        <div className="app-dialog grid gap-3">
          <h2 id="ok-anon" className="app-neworders-title">{t.anonTitle}</h2>
          <p>{t.anonLead}</p>
          <div className="ok-actions">
            <button type="button" className="btn btn-sm" onClick={async () => { const r = await api(`/customers/${id}/anonymize`, { method: "POST", body: {} }); setAnon(false); if (r.ok) { toast.show(t.anonDone); void load(); onChanged(); } }}>{t.anonYes}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAnon(false)}>{t.cancel}</button>
          </div>
        </div>
      </Modal>
      {edit ? (
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void patch({ name: edit.name, email: edit.email, company: edit.company || null, edrpou: edit.edrpou }).then(() => setEdit(null)); }}>
          <Field label={t.name}>{(p) => <input {...p} className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.email}>{(p) => <input {...p} className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />}</Field>
            <Field label={t.company}>{(p) => <input {...p} className="input" value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} />}</Field>
            <Field label={t.edrpou}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={10} value={edit.edrpou} onChange={(e) => setEdit({ ...edit, edrpou: e.target.value.replace(/\D/g, "") })} />}</Field>
          </div>
          <div className="ok-actions"><button className="btn btn-sm" type="submit">{t.save}</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>{t.cancel}</button></div>
        </form>
      ) : (
        <div className="ok-kv">
          <div><span>{t.phone}</span><b className="app-secret">{c.phone ?? "—"}</b></div>
          {c.email && <div><span>{t.email}</span><b>{c.email}</b></div>}
          {c.company && <div><span>{t.company}</span><b>{c.company}{c.edrpou ? ` · ${c.edrpou}` : ""}</b></div>}
          {c.delivery && <div><span>{t.delivery}</span><b>{[d.app.orders.methods[c.delivery.method as keyof typeof d.app.orders.methods] ?? c.delivery.method, c.delivery.city, c.delivery.branch, c.delivery.address].filter(Boolean).join(", ")}</b></div>}
          {c.firstSource && <div><span>{t.firstSource}</span><b>{(d.app.orderForm.sources as Record<string, string>)[c.firstSource] ?? (d.app.orders.sources as Record<string, string>)[c.firstSource] ?? c.firstSource}</b></div>}
          <div><span>{t.since}</span><b>{f.date(new Date(c.createdAt).getTime())}</b></div>
        </div>
      )}
      {!anonymized && (
        <>
          <div className="ok-sub">{t.tagsTitle}</div>
          <div className="ok-chips" role="group" aria-label={t.tagsTitle}>
            {[...PRESETS, ...(settings?.tags.map((x) => x.id) ?? [])].map((x) => (
              <button key={x} type="button" className="ok-chip" aria-pressed={c.tags.includes(x)} onClick={() => toggleTag(x)}>{settings?.tags.find((y) => y.id === x)?.name ?? (t.tags as Record<string, string>)[x]}</button>
            ))}
          </div>
        </>
      )}
      <div className="ok-sub">{t.history}</div>
      <form className="app-comment-form" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; const r = await api(`/customers/${id}/notes`, { method: "POST", body: { text: note.trim() } }); if (r.ok) { setNote(""); void load(); } }}>
        <label className="sr-only" htmlFor={`n-${id}`}>{t.noteAdd}</label>
        <input id={`n-${id}`} className="input" maxLength={2000} placeholder={t.noteAdd} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="btn btn-sm btn-secondary" disabled={!note.trim()}>{t.noteSend}</button>
      </form>
      <ol className="app-timeline">
        {line.map((x) =>
          x.order ? (
            <li key={`o${x.order.id}`}>
              <span className="app-timeline-what">
                <button type="button" className="ok-link" onClick={() => go("orders", `o-${x.order!.id}`)}>№{x.order.number}</button>
                <StatusBadge status={x.order.status} statusId={x.order.statusId} settings={orderSettings} />
                {x.order.totalKop !== null && <span className="num app-secret">{formatUAH(x.order.totalKop / 100, lang)}</span>}
              </span>
              <small className="ok-muted">{f.dateTime(new Date(x.at).getTime())}</small>
            </li>
          ) : (
            <li key={`n${x.note!.id}`}>
              <span className="app-timeline-what"><span className="app-comment">{x.note!.text}</span></span>
              <small className="ok-muted">{f.dateTime(new Date(x.at).getTime())} · {x.note!.by ?? "—"}</small>
            </li>
          ),
        )}
      </ol>
      {flash}
    </Panel>
  );
}

/** «Клієнти»: the base built from orders; `tab` — a segment or "c-<id>" to open one customer. */
export function CustomersScreen({ tab, finance, go }: { tab?: string | null; finance: boolean; go: (screen: string, tab?: string) => void }) {
  const d = useDict();
  const t = d.app.customers;
  const lang = useLang();
  const f = useFormat();
  const { settings } = useCustomerSettings();
  const [segment, setSegment] = useState<Segment>((SEGMENTS as readonly string[]).includes(tab ?? "") ? (tab as Segment) : "all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "last", dir: "desc" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(tab?.startsWith("c-") ? tab.slice(2) : null);
  const [next] = useState(latestOnly);
  const load = useCallback(async () => {
    const isLatest = next();
    const p = new URLSearchParams({ segment, sort: sort.key, dir: sort.dir, page: String(page), limit: String(PAGE + 1), ...(q.trim().length >= 2 ? { q: q.trim() } : {}) });
    const r = await api<Row[]>(`/customers?${p}`);
    if (r.ok && isLatest()) {
      setRows(r.data.slice(0, PAGE));
      setMore(r.data.length > PAGE);
    }
  }, [segment, sort, page, q, next]);
  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);
  useEscClose(open ? () => setOpen(null) : null);
  const toast = useToast();
  // Excel → «Зберегти як CSV»; the answer says how many were added, updated and which rows were skipped.
  // Excel as it is (.xlsx) or CSV: the file goes to the server as it was chosen.
  const importFile = async (file: File) => {
    const data = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
    const r = await api<{ created: number; updated: number; skipped: number[] }>("/customers/import", { method: "POST", body: { file: { name: file.name, data } } });
    if (!r.ok) return toast.show(r.error === "no_phone_column" ? t.importNoPhone : t.importFailed, "warn");
    toast.show(fmt(t.imported, { created: r.data.created, updated: r.data.updated }));
    if (r.data.skipped.length) toast.show(fmt(t.importSkipped, { rows: r.data.skipped.join(", ") }), "warn");
    void load();
  };
  const downloadTemplate = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`\uFEFF${t.templateCsv}`], { type: "text/csv;charset=utf-8" }));
    a.download = "customers-template.csv";
    a.click();
  };
  const cols: Col<Row>[] = [
    {
      key: "name",
      label: t.name,
      sort: true,
      fixed: true,
      render: (c) => (
        <span className="app-cell-main">
          <b>{c.name}</b>
          {(c.auto.length > 0 || c.tags.length > 0) && <span className="app-tags">{[...c.auto, ...c.tags].map((x) => <TagChip key={x} id={x} settings={settings} />)}</span>}
        </span>
      ),
    },
    { key: "phone", label: t.phone, render: (c) => <span className="num app-secret">{c.phone ?? "—"}</span> },
    { key: "orders", label: t.orders, sort: true, align: "end", render: (c) => <span className="num">{c.orders}</span> },
    ...(finance ? [{ key: "sum", label: t.sum, sort: true as const, align: "end" as const, render: (c: Row) => (c.sumKop === null ? null : <span className="num app-secret">{formatUAH(c.sumKop / 100, lang)}</span>) }] : []),
    { key: "last", label: t.last, sort: true, render: (c) => (c.lastAt ? <span title={f.dateTime(new Date(c.lastAt).getTime())}>{f.ago(new Date(c.lastAt).getTime())}</span> : null) },
    { key: "city", label: t.city, render: (c) => c.city },
    { key: "source", label: t.firstSource, render: (c) => (c.firstSource ? (d.app.orderForm.sources as Record<string, string>)[c.firstSource] ?? (d.app.orders.sources as Record<string, string>)[c.firstSource] ?? c.firstSource : null) },
  ];
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        <div className="ok-actions">
          <label className="btn btn-sm btn-ghost">
            <Icon name="doc" size={15} />{t.import}
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) await importFile(file); }} />
          </label>
          <button type="button" className="ok-link" onClick={downloadTemplate}>{t.template}</button>
          {settings?.canEdit && <a className="btn btn-sm btn-ghost" href="/api/customers/export" download><Icon name="doc" size={15} />{t.export}</a>}
        </div>
      </div>
      <div className="ok-chips" role="group" aria-label={t.segments}>
        {SEGMENTS.map((s) => (
          <button key={s} type="button" className="ok-chip" aria-pressed={segment === s} onClick={() => { setSegment(s); setPage(1); }}>{s === "sleeping" && settings ? fmt(t.segs.sleeping, { n: settings.sleepDays }) : t.segs[s]}</button>
        ))}
        <label className="app-filter-search">
          <span className="sr-only">{t.search}</span>
          <input className="input" placeholder={t.search} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
      </div>
      <div className="ok-split" data-open={!!open}>
        <Panel>
          {rows && rows.length === 0 && page === 1 ? (
            <Empty icon="person" text={q || segment !== "all" ? t.nothing : t.empty} />
          ) : (
            <Table id="customers" label={t.title} rows={rows ?? []} cols={cols} active={open} onOpen={(c) => setOpen(c.id)} sort={sort} onSort={setSort} page={page} onPage={setPage} hasMore={more} />
          )}
        </Panel>
        {open && <CustomerCard id={open} key={open} settings={settings} finance={finance} onChanged={load} onClose={() => setOpen(null)} go={go} />}
      </div>
    </div>
  );
}

const COLORS = ["#2f6fd6", "#1e8a5a", "#a8701a", "#b04a42", "#7a4bc2", "#0f8a94", "#c2410c", "#52606d"];

/** «Бізнес → Клієнти»: own tags with colours and after how many days without a purchase a customer is «сплячий». */
export function BusinessCustomers() {
  const t = useDict().app.businessCustomers;
  const [flash, show] = useFlash();
  const { settings, reload } = useCustomerSettings();
  const [f, setF] = useState<{ tags: CustomerTag[]; sleepDays: string } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  useEffect(() => {
    if (settings && !f) setF({ tags: settings.tags, sleepDays: String(settings.sleepDays) });
  }, [settings, f]);
  if (!settings || !f) return null;
  const save = async (next = f) => {
    const r = await api("/customers/settings", { method: "PUT", body: { tags: next.tags, sleepDays: Math.max(14, Math.min(730, Number(next.sleepDays) || 90)) } });
    if (!r.ok) return playSound("error");
    playSound("success");
    show(t.saved);
    void reload();
  };
  const add = () => {
    const id = `t_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
    const next = { ...f, tags: [...f.tags, { id, name: name.trim(), color }] };
    setF(next);
    setName("");
    void save(next);
  };
  return (
    <Panel title={t.title}>
      <p className="ok-muted">{t.lead}</p>
      <div className="app-tags">
        {f.tags.map((x) => (
          <span key={x.id} className="app-tag app-word" style={{ ["--tag" as string]: x.color }}>
            {x.name}
            <button type="button" aria-label={`${t.remove}: ${x.name}`} onClick={() => { const next = { ...f, tags: f.tags.filter((y) => y.id !== x.id) }; setF(next); void save(next); }}><Icon name="close" size={11} /></button>
          </span>
        ))}
      </div>
      <div className="ok-form-row">
        <Field label={t.tagName}>{(p) => <input {...p} className="input" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="app-colors" role="radiogroup" aria-label={t.color}>
          {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} style={{ background: c }} onClick={() => setColor(c)} />)}
        </div>
        <button type="button" className="btn btn-sm btn-secondary" disabled={!name.trim() || !settings.canEdit} onClick={add}>{t.add}</button>
      </div>
      <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t.sleep} hint={t.sleepHint}>{(p) => <input {...p} className="input" inputMode="numeric" style={{ maxWidth: "8rem" }} value={f.sleepDays} onChange={(e) => setF({ ...f, sleepDays: e.target.value.replace(/\D/g, "").slice(0, 3) })} />}</Field>
        <span />
        <button type="submit" className="btn btn-sm" disabled={!settings.canEdit}>{t.save}</button>
      </form>
      {flash}
    </Panel>
  );
}
