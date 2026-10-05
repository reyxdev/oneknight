"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { useModal } from "@/components/global/ModalProvider";
import { api } from "@/lib/api";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";
import { Field } from "@/components/ui/Field";
import { useToast } from "./Toasts";

export type LeadStatus = "new" | "contacted" | "proposal" | "prepaid" | "in_work" | "done" | "lost" | "thinking" | "agreed" | "no_answer";
type MyLead = { id: string; number: number; service: string; siteType: string | null; status: LeadStatus; business: string; createdAt: string };

const pill: Record<LeadStatus, string> = { new: "new", contacted: "confirmed", proposal: "confirmed", prepaid: "paid", in_work: "shipped", done: "done", lost: "cancelled", thinking: "confirmed", agreed: "paid", no_answer: "new" };

function useLeads<T>(path: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    const r = await api<T[]>(path);
    setError(!r.ok);
    if (r.ok) setRows(r.data);
  }, [path]);
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("ok:lead-created", on);
    return () => window.removeEventListener("ok:lead-created", on);
  }, [load]);
  return { rows, error, load };
}

/** The customer's own requests, with status. "Нова заявка" opens the same brief as the public site. */
export function MyLeads() {
  const d = useDict();
  const t = d.app.leads;
  const f = useFormat();
  const { openOrder } = useModal();
  const { rows, error, load } = useLeads<MyLead>("/leads/mine");
  return (
    <Panel
      title={t.title}
      action={<button type="button" className="btn btn-sm" onClick={() => openOrder("brief")}><Icon name="plus" size={15} />{t.new}</button>}
    >
      {error ? (
        <p className="ok-muted">{t.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>
      ) : rows && rows.length === 0 ? (
        <p className="ok-muted">{d.app.home.ordersEmpty}</p>
      ) : (
        <ul className="ok-list">
          {(rows ?? []).map((l) => (
            <li key={l.id}>
              <span className="num ok-muted">#{l.number}</span>
              <span className="ok-grow">
                <b>{d.order.service[l.service as keyof typeof d.order.service] as string}{l.siteType && l.siteType !== "unsure" ? ` · ${d.siteTypes[l.siteType as keyof typeof d.siteTypes]}` : ""}</b>
                <small>{l.business}</small>
              </span>
              <small className="ok-muted">{f.date(new Date(l.createdAt).getTime())}</small>
              <span className="ok-pill" data-s={pill[l.status]}>{t.status[l.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

type AdminLead = MyLead & {
  name: string;
  phone: string;
  email: string | null;
  source: string;
  brief: Record<string, unknown>;
  late: boolean;
  notes: number;
  remindAt: string | null;
  remindText: string | null;
  lostReason: string | null;
  project: { id: string; number: number } | null;
};
/** Portfolio leads (answer 414) use new · no_answer · contacted · thinking · agreed · lost; projects go on from prepaid. */
export const LEAD_STATUSES: LeadStatus[] = ["new", "no_answer", "contacted", "thinking", "agreed", "proposal", "prepaid", "in_work", "done", "lost"];
const BRIEF_KEYS = ["business", "about", "audience", "logo", "photos", "features", "references", "special"] as const;

/** One lead: contacts, the brief, the status (a lost one keeps its reason), a reminder, notes, «Почати проєкт». */
function LeadCard({ lead, onChanged, onClose, openProject }: { lead: AdminLead; onChanged: () => void; onClose: () => void; openProject: (id: string) => void }) {
  const d = useDict();
  const t = d.app.admin;
  const f = useFormat();
  const toast = useToast();
  const [notes, setNotes] = useState<{ id: string; text: string; at: string; by: string | null }[]>([]);
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState({ at: lead.remindAt ? toLocal(lead.remindAt) : "", text: lead.remindText ?? "" });
  const [invite, setInvite] = useState<string | null>(null);
  const loadNotes = useCallback(async () => {
    const r = await api<typeof notes>(`/admin/leads/${lead.id}/notes`);
    if (r.ok) setNotes(r.data);
  }, [lead.id]);
  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);
  const patch = async (body: object, done = t.changed) => {
    const r = await api(`/admin/leads/${lead.id}`, { method: "PATCH", body });
    if (!r.ok) return toast.show(d.app.auth.errors.server_error, "warn");
    toast.show(done);
    onChanged();
  };
  const start = async () => {
    const r = await api<{ id: string; invite: string | null }>(`/admin/leads/${lead.id}/project`, { method: "POST", body: {} });
    if (!r.ok) return toast.show(d.app.auth.errors.server_error, "warn");
    onChanged();
    if (r.data.invite) setInvite(`${location.origin}/app/?start=register&project=${r.data.invite}`);
    else openProject(r.data.id);
  };
  const service = `${d.order.service[lead.service as keyof typeof d.order.service] as string}${lead.siteType && lead.siteType !== "unsure" ? ` · ${d.siteTypes[lead.siteType as keyof typeof d.siteTypes]}` : ""}`;
  return (
    <Panel className="ok-detail" title={`#${lead.number} · ${lead.name}`} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <div className="ok-kv">
        <div><span>{t.contact}</span><b><a className="ok-link" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a></b>{lead.email && <a className="ok-link" href={`mailto:${lead.email}`}>{lead.email}</a>}</div>
        <div><span>{t.what}</span><b>{service}</b><small className="ok-muted">{f.dateTime(new Date(lead.createdAt).getTime())} · {t.source[lead.source as keyof typeof t.source] ?? lead.source}</small></div>
      </div>
      {lead.brief.origin === "portfolio" && <PortfolioBrief brief={lead.brief} />}
      <dl className="app-brief">
        {BRIEF_KEYS.filter((k) => lead.brief[k] !== undefined && lead.brief[k] !== "" && !(Array.isArray(lead.brief[k]) && !(lead.brief[k] as unknown[]).length)).map((k) => (
          <div key={k}><dt>{(t.brief as Record<string, string>)[k]}</dt><dd>{Array.isArray(lead.brief[k]) ? (lead.brief[k] as string[]).join(", ") : String(lead.brief[k])}</dd></div>
        ))}
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.statusLabel}>
          {(p) => (
            <select {...p} className="input" value={lead.status} onChange={(e) => patch({ status: e.target.value })}>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{d.app.leads.status[s]}</option>)}
            </select>
          )}
        </Field>
        {lead.status === "lost" && <Field label={t.lostReason}>{(p) => <input {...p} className="input" maxLength={300} defaultValue={lead.lostReason ?? ""} onBlur={(e) => { if (e.target.value !== (lead.lostReason ?? "")) void patch({ lostReason: e.target.value || null }); }} />}</Field>}
      </div>
      <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); void patch({ remindAt: remind.at ? new Date(remind.at).toISOString() : null, remindText: remind.text || null }, t.remindSaved); }}>
        <Field label={t.remindAt}>{(p) => <input {...p} className="input" type="datetime-local" value={remind.at} onChange={(e) => setRemind({ ...remind, at: e.target.value })} />}</Field>
        <Field label={t.remindText}>{(p) => <input {...p} className="input" maxLength={300} value={remind.text} onChange={(e) => setRemind({ ...remind, text: e.target.value })} />}</Field>
        <button type="submit" className="btn btn-sm btn-secondary">{t.remindSave}</button>
      </form>
      {lead.project ? (
        <button type="button" className="btn btn-sm btn-secondary" style={{ justifySelf: "start" }} onClick={() => openProject(lead.project!.id)}>{fmt(t.openProject, { n: lead.project.number })}</button>
      ) : (
        <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={start}><Icon name="plus" size={15} />{t.startProject}</button>
      )}
      {invite && (
        <Field label={t.inviteLink} hint={t.inviteHint}>{(p) => <input {...p} className="input" readOnly value={invite} onFocus={(e) => e.target.select()} />}</Field>
      )}
      <form className="ok-form-row" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await api(`/admin/leads/${lead.id}/notes`, { method: "POST", body: { text: note.trim() } }); setNote(""); void loadNotes(); onChanged(); }}>
        <Field label={t.note}>{(p) => <input {...p} className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <button type="submit" className="btn btn-sm btn-secondary" disabled={!note.trim()}>{t.addNote}</button>
      </form>
      {notes.length > 0 && (
        <ol className="app-timeline">
          {notes.map((n) => <li key={n.id}><span className="app-timeline-what">{n.text}</span><small className="ok-muted">{f.dateTime(new Date(n.at).getTime())}{n.by ? ` · ${n.by}` : ""}</small></li>)}
        </ol>
      )}
    </Panel>
  );
}

/** A lead from the portfolio: how to reach and what the calculator gave (computed again on the server). */
function PortfolioBrief({ brief }: { brief: Record<string, unknown> }) {
  const d = useDict();
  const t = d.app.admin;
  const e = brief.estimate as { big: boolean; total?: number; from?: number; save?: number } | undefined;
  const c = brief.calc as { kind: string; sprava: string | null; extras: string[]; earn?: number | null } | undefined;
  const how = brief.contact as keyof typeof t.pfHows | undefined;
  return (
    <div className="ok-kv">
      {how && <div><span>{t.pfHow}</span><b>{t.pfHows[how]}</b></div>}
      {c && e && (
        <div>
          <span>{t.pfCalc}</span>
          <b className="num">{e.big ? `≥ ${e.from}` : `≈ ${e.total}`} {d.app.siteAdmin.uah}</b>
          <small className="ok-muted">{[c.kind, c.sprava, ...c.extras, c.earn ? `${c.earn} ${d.app.siteAdmin.uah}` : null].filter(Boolean).join(" · ")}</small>
        </div>
      )}
    </div>
  );
}

/** «2026-10-01T12:30» for <input type="datetime-local"> in the browser's time. */
function toLocal(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** «Заявки»: the sales funnel as a board (drag a card to move it), the card on the right. */
export function AdminLeads({ openProject }: { openProject: (id: string) => void }) {
  const d = useDict();
  const t = d.app.admin;
  const toast = useToast();
  const { rows, error, load } = useLeads<AdminLead>("/admin/leads");
  const [open, setOpen] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStatus | null>(null);
  const move = async (l: AdminLead, status: LeadStatus) => {
    const r = await api(`/admin/leads/${l.id}`, { method: "PATCH", body: { status } });
    void load();
    if (r.ok) toast.undo(fmt(t.moved, { n: l.number, s: d.app.leads.status[status] }), { undo: async () => { await api(`/admin/leads/${l.id}`, { method: "PATCH", body: { status: l.status } }); void load(); } });
  };
  const lead = rows?.find((l) => l.id === open) ?? null;
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      {error ? (
        <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>
      ) : rows && rows.length === 0 ? (
        <Panel><p className="ok-muted">{t.empty}</p></Panel>
      ) : (
        <div className="ok-split" data-open={!!lead}>
          <div className="app-board" role="list">
            {LEAD_STATUSES.map((s) => {
              const list = (rows ?? []).filter((l) => l.status === s);
              return (
                <section key={s} role="listitem" className="app-board-col" data-over={over === s || undefined} aria-label={d.app.leads.status[s]} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const l = rows?.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (l && l.status !== s) void move(l, s); }}>
                  <header><span className="ok-pill" data-s={pill[s]}>{d.app.leads.status[s]}</span><span className="ok-muted num">{list.length}</span></header>
                  {list.map((l) => (
                    <button key={l.id} type="button" className="app-card" data-late={l.late || undefined} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)} onClick={() => setOpen(l.id)}>
                      <span className="app-card-top"><span className="num ok-muted">#{l.number}</span>{l.late && <span className="ok-pill" data-s="cancelled">{t.late}</span>}</span>
                      <b>{l.name}</b>
                      <small className="ok-muted">{d.order.service[l.service as keyof typeof d.order.service] as string}{l.notes ? ` · ${fmt(t.notesN, { n: l.notes })}` : ""}</small>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
          {lead && <LeadCard key={lead.id} lead={lead} onChanged={load} onClose={() => setOpen(null)} openProject={openProject} />}
        </div>
      )}
    </div>
  );
}
