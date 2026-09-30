"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { readImage } from "@/lib/files";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";
import { useToast } from "./Toasts";

const STAGES = ["brief", "design", "development", "content", "launch", "done"] as const;
type Stage = (typeof STAGES)[number];
type Payment = { id: string; label: string; amountKop: number; paidAt: string | null };
export type Project = {
  id: string;
  number: number;
  title: string;
  domain: string | null;
  stage: Stage;
  awaiting: boolean;
  approvals: Record<string, { approvedAt?: string; revisions?: number }>;
  deadline: string | null;
  amountKop: number | null;
  payments: Payment[];
  paidKop: number;
  launchedAt: string | null;
  organizationId: string | null;
  organization?: string | null;
  invitePending?: boolean;
  items: { id: string; text: string; done: boolean; files: { id: string; url: string }[] }[];
  comments: { id: string; kind: string; text: string; fromAdmin: boolean; file: string | null; at: string; by: string | null }[];
};

/** Stages as steps: done ones ticked, the current one marked (and «на погодженні» when waiting for the client). */
function Steps({ p }: { p: Project }) {
  const t = useDict().app.projects;
  const cur = STAGES.indexOf(p.stage);
  return (
    <ol className="app-steps" aria-label={t.stages}>
      {STAGES.slice(0, 5).map((s, i) => (
        <li key={s} data-state={p.stage === "done" || i < cur ? "done" : i === cur ? "current" : undefined}>
          <span>{i < cur || p.stage === "done" ? <Icon name="check" size={12} /> : i + 1}</span>
          {t.stage[s]}
          {p.approvals[s]?.revisions ? <small>{fmt(t.revisions, { n: p.approvals[s]!.revisions! })}</small> : null}
        </li>
      ))}
    </ol>
  );
}

/** The project's history: comments (with a picture), «готово до погодження», approvals, changes, stage moves. */
function Thread({ p, post }: { p: Project; post: (text: string, file?: { name: string; data: string }) => Promise<boolean> }) {
  const t = useDict().app.projects;
  const f = useFormat();
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    if (await post(text.trim(), file ?? undefined)) {
      setText("");
      setFile(null);
    }
  };
  const line = (c: Project["comments"][number]) =>
    c.kind === "comment" ? c.text : c.kind === "stage" ? fmt(t.ev.stage, { s: t.stage[c.text as Stage] ?? c.text }) : c.kind === "approved" ? fmt(t.ev.approved, { s: t.stage[c.text as Stage] ?? c.text }) : c.kind === "ready" ? `${t.ev.ready}${c.text ? `: ${c.text}` : ""}` : c.kind === "changes" ? `${t.ev.changes}: ${c.text}` : c.kind === "launched" ? fmt(t.ev.launched, { d: c.text }) : c.text;
  return (
    <div className="grid gap-3">
      {p.comments.length > 0 && (
        <ol className="app-pthread">
          {p.comments.map((c) => (
            <li key={c.id} data-admin={c.fromAdmin || undefined} data-kind={c.kind}>
              <small className="ok-muted">{c.fromAdmin ? t.fromUs : c.by ?? t.client} · {f.dateTime(new Date(c.at).getTime())}</small>
              <p>{line(c)}</p>
              {c.file && <a href={c.file} target="_blank" rel="noopener"><img className="app-pthread-img" src={c.file} alt="" loading="lazy" /></a>}
            </li>
          ))}
        </ol>
      )}
      <form className="grid gap-2" onSubmit={send}>
        <Field label={t.message}>{(pr) => <textarea {...pr} className="input" rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        <div className="ok-actions">
          <button type="submit" className="btn btn-sm" disabled={!text.trim() && !file}>{t.send}</button>
          <label className="btn btn-sm btn-ghost">
            <Icon name="image" size={15} />{file ? file.name : t.attach}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) setFile(await readImage(x)); }} />
          </label>
        </div>
      </form>
    </div>
  );
}

function Money({ p }: { p: Project }) {
  const t = useDict().app.projects;
  const lang = useLang();
  if (p.amountKop === null && !p.payments.length) return null;
  return (
    <div className="grid gap-2">
      <div className="ok-kv">
        {p.amountKop !== null && <div><span>{t.amount}</span><b className="num app-secret">{formatUAH(p.amountKop / 100, lang)}</b></div>}
        <div><span>{t.paid}</span><b className="num app-secret">{formatUAH(p.paidKop / 100, lang)}</b></div>
      </div>
      {p.payments.length > 0 && (
        <ul className="ok-list">
          {p.payments.map((x) => (
            <li key={x.id}>
              <span className="ok-grow">{x.label}</span>
              <span className="num app-secret">{formatUAH(x.amountKop / 100, lang)}</span>
              <span className="ok-pill" data-s={x.paidAt ? "done" : "new"}>{x.paidAt ? t.paidMark : t.notPaid}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Послуги» for the client: our work on their website — stages to approve, what we need from them, messages. */
export function MyProjects() {
  const d = useDict();
  const t = d.app.projects;
  const toast = useToast();
  const [list, setList] = useState<Project[] | null>(null);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await api<Project[]>("/projects");
    if (r.ok) setList(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!list?.length) return null;
  const call = async (url: string, body: object, done?: string) => {
    const r = await api<Project>(url, { method: url.includes("/items/") ? "PATCH" : "POST", body });
    if (!r.ok) {
      toast.show(d.app.auth.errors.server_error, "warn");
      return false;
    }
    if (done) toast.show(done);
    void load();
    return true;
  };
  return (
    <>
      {list.map((p) => (
        <Panel key={p.id} title={fmt(t.clientTitle, { n: p.number, title: p.title })}>
          <Steps p={p} />
          {p.stage === "done" ? (
            <p className="ok-note">{fmt(t.launchedNote, { d: p.domain ?? p.title })}</p>
          ) : p.awaiting ? (
            <div className="app-approve">
              <p><b>{fmt(t.readyToApprove, { s: t.stage[p.stage] })}</b></p>
              <div className="ok-actions">
                <button type="button" className="btn btn-sm" onClick={() => call(`/projects/${p.id}/approve`, {}, t.approvedDone)}><Icon name="check" size={15} />{t.approve}</button>
              </div>
              <form className="ok-form-row" onSubmit={async (e) => { e.preventDefault(); if ((changes[p.id] ?? "").trim().length >= 3 && (await call(`/projects/${p.id}/changes`, { text: changes[p.id]!.trim() }, t.changesSent))) setChanges({ ...changes, [p.id]: "" }); }}>
                <Field label={t.changesLabel}>{(pr) => <input {...pr} className="input" maxLength={4000} value={changes[p.id] ?? ""} onChange={(e) => setChanges({ ...changes, [p.id]: e.target.value })} />}</Field>
                <button type="submit" className="btn btn-sm btn-secondary" disabled={(changes[p.id] ?? "").trim().length < 3}>{t.askChanges}</button>
              </form>
            </div>
          ) : (
            <p className="ok-muted">{fmt(t.inWork, { s: t.stage[p.stage] })}{p.deadline ? ` · ${fmt(t.deadlineIs, { d: p.deadline })}` : ""}</p>
          )}
          {p.items.length > 0 && (
            <fieldset className="app-q">
              <legend>{t.needFromYou}</legend>
              <ul className="app-checklist">
                {p.items.map((i) => (
                  <li key={i.id}>
                    <label><input type="checkbox" checked={i.done} onChange={(e) => call(`/projects/${p.id}/items/${i.id}`, { done: e.target.checked })} /> {i.text}</label>
                    {i.files.map((f) => <a key={f.id} href={f.url} target="_blank" rel="noopener"><img className="app-thumb" src={f.url} alt="" /></a>)}
                    <label className="ok-link">
                      {t.upload}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) await call(`/projects/${p.id}/items/${i.id}`, { file: await readImage(x) }, t.uploaded); }} />
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <Money p={p} />
          <Thread p={p} post={(text, file) => call(`/projects/${p.id}/comments`, { text, ...(file ? { file } : {}) })} />
        </Panel>
      ))}
    </>
  );
}

/** Ivan's project card: details, manual money marks, the stage, «На погодження», checklist, messages, «Запустити». */
function AdminProject({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const d = useDict();
  const t = d.app.projects;
  const toast = useToast();
  const [p, setP] = useState<Project | null>(null);
  const [form, setForm] = useState({ title: "", domain: "", deadline: "", amount: "" });
  const [pays, setPays] = useState<(Omit<Payment, "amountKop"> & { amount: string })[]>([]);
  const [item, setItem] = useState("");
  const [readyText, setReadyText] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Project>(`/admin/projects/${id}`);
    if (!r.ok) return;
    setP(r.data);
    setForm({ title: r.data.title, domain: r.data.domain ?? "", deadline: r.data.deadline ?? "", amount: r.data.amountKop === null ? "" : String(r.data.amountKop / 100) });
    setPays(r.data.payments.map((x) => ({ ...x, amount: String(x.amountKop / 100) })));
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!p) return null;
  const send = async (method: "POST" | "PATCH" | "DELETE", url: string, body: object, done = t.saved) => {
    const r = await api<Project>(`/admin/projects/${id}${url}`, { method, body });
    if (!r.ok) {
      toast.show((t.errors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error, "warn");
      return false;
    }
    toast.show(done);
    setP(r.data);
    onChanged();
    return true;
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void send("PATCH", "", {
      title: form.title.trim(),
      domain: form.domain.trim() || null,
      deadline: form.deadline || null,
      amountKop: form.amount ? Math.round(Number(form.amount.replace(",", ".")) * 100) : null,
      payments: pays.filter((x) => x.label.trim()).map((x) => ({ id: x.id || undefined, label: x.label.trim(), amountKop: Math.round(Number(x.amount.replace(",", ".") || 0) * 100), paidAt: x.paidAt })),
    });
  };
  return (
    <Panel className="ok-detail" title={`№${p.number} · ${p.title}`} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <Steps p={p} />
      <div className="ok-kv">
        <div><span>{t.client}</span><b>{p.organization ?? t.noClient}</b></div>
        {p.awaiting && <div><span>{t.stageNow}</span><b>{fmt(t.awaitingClient, { s: t.stage[p.stage] })}</b></div>}
      </div>
      {p.invitePending && (
        <div className="grid gap-2">
          <p className="ok-muted">{t.invitePending}</p>
          <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={async () => { const r = await api<{ invite: string }>(`/admin/projects/${id}/invite`, { method: "POST", body: {} }); if (r.ok) setInvite(`${location.origin}/app/?start=register&project=${r.data.invite}`); }}>{t.newInvite}</button>
          {invite && <Field label={t.inviteLink}>{(pr) => <input {...pr} className="input" readOnly value={invite} onFocus={(e) => e.target.select()} />}</Field>}
        </div>
      )}
      <div className="grid gap-3">
        <Field label={t.stageLabel}>
          {(pr) => (
            <select {...pr} className="input" value={p.stage} onChange={(e) => send("PATCH", "", { stage: e.target.value })}>
              {STAGES.filter((s) => s !== "done").map((s) => <option key={s} value={s}>{t.stage[s]}</option>)}
            </select>
          )}
        </Field>
        {p.stage !== "done" && !p.awaiting && (
          <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); void send("POST", "/ready", { text: readyText.trim() }, t.readySent).then((ok) => ok && setReadyText("")); }}>
            <Field label={t.readyText}>{(pr) => <input {...pr} className="input" maxLength={2000} value={readyText} onChange={(e) => setReadyText(e.target.value)} />}</Field>
            <button type="submit" className="btn btn-sm">{t.ready}</button>
          </form>
        )}
      </div>
      <form className="grid gap-3" onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.title}>{(pr) => <input {...pr} className="input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label={t.domain} hint={t.domainHint}>{(pr) => <input {...pr} className="input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />}</Field>
          <Field label={t.deadline}>{(pr) => <input {...pr} className="input" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />}</Field>
          <Field label={t.amountUah}>{(pr) => <input {...pr} className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, "") })} />}</Field>
        </div>
        <fieldset className="app-q">
          <legend>{t.payments}</legend>
          <p className="ok-muted">{t.paymentsHint}</p>
          {pays.map((x, i) => (
            <div key={x.id || i} className="app-pay-row">
              <input className="input" aria-label={t.payLabel} placeholder={t.payLabel} maxLength={100} value={x.label} onChange={(e) => setPays(pays.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
              <input className="input" aria-label={t.amountUah} placeholder={t.amountUah} inputMode="decimal" value={x.amount} onChange={(e) => setPays(pays.map((y, j) => (j === i ? { ...y, amount: e.target.value.replace(/[^\d.,]/g, "") } : y)))} />
              <label><input type="checkbox" checked={!!x.paidAt} onChange={(e) => setPays(pays.map((y, j) => (j === i ? { ...y, paidAt: e.target.checked ? new Date().toISOString() : null } : y)))} /> {t.paidMark}</label>
              <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.payRemove} onClick={() => setPays(pays.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button type="button" className="ok-link" style={{ justifySelf: "start" }} onClick={() => setPays([...pays, { id: "", label: "", amount: "", paidAt: null }])}><Icon name="plus" size={13} /> {t.payAdd}</button>
        </fieldset>
        <button type="submit" className="btn btn-sm" style={{ justifySelf: "start" }}>{t.save}</button>
      </form>
      <fieldset className="app-q">
        <legend>{t.needFromClient}</legend>
        <ul className="app-checklist">
          {p.items.map((i) => (
            <li key={i.id}>
              <span className="ok-pill" data-s={i.done ? "done" : "new"}>{i.done ? t.itemDone : t.itemWaiting}</span>
              <span className="ok-grow">{i.text}</span>
              {i.files.map((f) => <a key={f.id} href={f.url} target="_blank" rel="noopener"><img className="app-thumb" src={f.url} alt="" /></a>)}
              <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.itemRemove} onClick={() => send("DELETE", `/items/${i.id}`, {})}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
        <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void send("POST", "/items", { text: item.trim() }).then((ok) => ok && setItem("")); }}>
          <Field label={t.itemNew}>{(pr) => <input {...pr} className="input" maxLength={300} value={item} onChange={(e) => setItem(e.target.value)} />}</Field>
          <button type="submit" className="btn btn-sm btn-secondary" disabled={!item.trim()}>{t.add}</button>
        </form>
      </fieldset>
      <Thread p={p} post={(text, file) => send("POST", "/comments", { text, ...(file ? { file } : {}) }, t.sent)} />
      {!p.launchedAt && (
        <div className="grid gap-2">
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} disabled={!p.organizationId} onClick={() => send("POST", "/launch", {}, t.launched)}><Icon name="bolt" size={15} />{t.launch}</button>
          <p className="ok-muted">{p.organizationId ? t.launchHint : t.launchNeedsClient}</p>
        </div>
      )}
    </Panel>
  );
}

/** Admin «Проєкти»: a board by stage (drag to move), the card on the right. `tab` "p-<id>" opens one. */
export function AdminProjects({ tab }: { tab?: string | null }) {
  const d = useDict();
  const t = d.app.projects;
  const f = useFormat();
  const toast = useToast();
  const [rows, setRows] = useState<Project[] | null>(null);
  const [open, setOpen] = useState<string | null>(tab?.startsWith("p-") ? tab.slice(2) : null);
  const [over, setOver] = useState<Stage | null>(null);
  const load = useCallback(async () => {
    const r = await api<Project[]>("/admin/projects");
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const move = async (p: Project, stage: Stage) => {
    const r = await api(`/admin/projects/${p.id}`, { method: "PATCH", body: { stage } });
    void load();
    if (r.ok) toast.show(fmt(t.movedTo, { n: p.number, s: t.stage[stage] }));
  };
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.adminTitle}</h3></div>
      <p className="ok-muted">{t.adminLead}</p>
      {rows && rows.length === 0 ? (
        <Panel><p className="ok-muted">{t.empty}</p></Panel>
      ) : (
        <div className="ok-split" data-open={!!open}>
          <div className="app-board" role="list">
            {STAGES.map((s) => {
              const list = (rows ?? []).filter((p) => p.stage === s);
              return (
                <section key={s} role="listitem" className="app-board-col" data-over={over === s || undefined} aria-label={t.stage[s]} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const p = rows?.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (p && p.stage !== s && s !== "done") void move(p, s); }}>
                  <header><span className="ok-pill" data-s={s === "done" ? "done" : "confirmed"}>{t.stage[s]}</span><span className="ok-muted num">{list.length}</span></header>
                  {list.map((p) => (
                    <button key={p.id} type="button" className="app-card" draggable={s !== "done"} onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)} onClick={() => setOpen(p.id)}>
                      <span className="app-card-top"><span className="num ok-muted">№{p.number}</span>{p.awaiting && <span className="ok-pill" data-s="shipped">{t.awaiting}</span>}</span>
                      <b>{p.title}</b>
                      <small className="ok-muted">{p.organization ?? (p.invitePending ? t.invitePendingShort : t.noClient)}</small>
                      {p.deadline && !p.launchedAt && <small data-bad={p.deadline < today || undefined}>{fmt(t.deadlineIs, { d: f.date(new Date(p.deadline).getTime()) })}</small>}
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
          {open && <AdminProject key={open} id={open} onChanged={load} onClose={() => setOpen(null)} />}
        </div>
      )}
    </div>
  );
}
