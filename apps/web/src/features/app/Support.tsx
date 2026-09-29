"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { oneknightPricing } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { fileUrl, readImage } from "@/lib/files";
import { playSound } from "@/lib/sound";
import { Empty, Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type Category = "bug" | "question" | "change" | "oneknight" | "site" | "other";
type Ticket = { id: string; number: number; category: Category; status: "open" | "answered" | "closed"; updatedAt: string; org?: string };
type Message = { id: string; staff: boolean; body: string; fileId: string | null; at: string; author: string | null };
const pill = { open: "new", answered: "done", closed: "cancelled" } as const;

function AttachPicker({ value, onChange }: { value: { name: string; data: string } | null; onChange: (v: { name: string; data: string } | null) => void }) {
  const t = useDict().app.support;
  return value ? (
    <div className="ok-shot">
      <img src={value.data} alt="" />
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>{t.remove}</button>
    </div>
  ) : (
    <label className="btn btn-sm btn-secondary ok-file">
      <Icon name="image" size={16} />{t.attach}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await readImage(f)); e.target.value = ""; }} />
    </label>
  );
}

function Thread({ id, admin, onBack }: { id: string; admin: boolean; onBack: () => void }) {
  const d = useDict();
  const t = d.app.support;
  const f = useFormat();
  const base = admin ? "/admin/tickets" : "/tickets";
  const [data, setData] = useState<(Ticket & { messages: Message[] }) | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Ticket & { messages: Message[] }>(`${base}/${id}`);
    if (r.ok) setData(r.data);
  }, [base, id]);
  useEffect(() => {
    void load();
  }, [load]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const r = await api(`${base}/${id}/messages`, { method: "POST", body: { text, ...(file ? { attachment: file } : {}) } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr((t.errors as Record<string, string>)[r.error] ?? t.errors.server_error);
    }
    setErr(null);
    setText("");
    setFile(null);
    playSound("success");
    void load();
  };
  if (!data) return null;
  return (
    <div className="ok-screen">
      <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={onBack}>
        <Icon name="arrow" size={15} style={{ transform: "scaleX(-1)" }} />{t.back}
      </button>
      <div className="ok-h">
        <h3>{fmt(t.number, { n: data.number })} · {d.ok.support.categories[data.category]}</h3>
        <span className="ok-pill" data-s={pill[data.status]}>{t.status[data.status]}</span>
      </div>
      <ul className="app-thread">
        {data.messages.map((m) => (
          <li key={m.id} data-staff={m.staff}>
            <small>{m.staff ? t.staff : admin ? m.author : t.you} · {f.dateTime(new Date(m.at).getTime())}</small>
            <p>{m.body}</p>
            {m.fileId && <a href={fileUrl(m.fileId)} target="_blank" rel="noopener"><img src={fileUrl(m.fileId)} alt={t.screenshot} loading="lazy" /></a>}
          </li>
        ))}
      </ul>
      <form className="ok-form" onSubmit={send} noValidate>
        <Field label={t.reply} error={err ?? undefined}>{(p) => <textarea {...p} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        <AttachPicker value={file} onChange={setFile} />
        <div className="ok-actions">
          <button className="btn btn-sm" type="submit" disabled={busy || !text.trim()} data-loading={busy}><Icon name="send" size={15} />{t.send}</button>
          {admin && data.status !== "closed" && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { await api(`${base}/${id}`, { method: "PATCH", body: { status: "closed" } }); void load(); }}>{t.close}</button>
          )}
        </div>
      </form>
    </div>
  );
}

export function SupportScreen({ admin = false }: { admin?: boolean }) {
  const d = useDict();
  const t = d.app.support;
  const f = useFormat();
  const [flash, show] = useFlash();
  const [list, setList] = useState<Ticket[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cat, setCat] = useState<Category>("question");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Ticket[]>(admin ? "/admin/tickets" : "/tickets");
    if (r.ok) setList(r.data);
  }, [admin]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 5) return setErr(t.errors.invalid_input);
    setBusy(true);
    const r = await api<{ number: number }>("/tickets", { method: "POST", body: { category: cat, text, ...(file ? { attachment: file } : {}) } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr((t.errors as Record<string, string>)[r.error] ?? t.errors.server_error);
    }
    setErr(null);
    setText("");
    setFile(null);
    playSound("success");
    show(fmt(t.sent, { n: r.data.number }));
    void load();
  };

  if (open) return <Thread id={open} admin={admin} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{admin ? d.app.supportAdmin.title : t.title}</h3></div>
      {!admin && (
        <Panel title={t.create}>
          <form className="ok-form" onSubmit={submit} noValidate>
            <Field label={t.category}>
              {(p) => (
                <select {...p} className="input" value={cat} onChange={(e) => setCat(e.target.value as Category)}>
                  {(Object.keys(d.ok.support.categories) as Category[]).map((k) => (
                    <option key={k} value={k}>{d.ok.support.categories[k]}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t.text} error={err ?? undefined}>{(p) => <textarea {...p} className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
            <div className="field"><span className="label">{t.screenshot}</span><AttachPicker value={file} onChange={setFile} /></div>
            <div className="ok-actions">
              <button className="btn" type="submit" disabled={busy} data-loading={busy}><Icon name="send" size={16} />{t.send}</button>
              <span className="ok-muted">{fmt(t.target, { h: oneknightPricing.supportResponseHours })}</span>
            </div>
          </form>
        </Panel>
      )}
      <Panel title={admin ? undefined : t.list}>
        {list && list.length === 0 ? (
          <Empty icon="chat" text={admin ? d.app.supportAdmin.empty : t.empty} />
        ) : (
          <ul className="ok-rows">
            {(list ?? []).map((x) => (
              <li key={x.id}>
                <button type="button" className="ok-row" onClick={() => setOpen(x.id)}>
                  <span className="num ok-muted">#{x.number}</span>
                  <span className="ok-grow"><b>{d.ok.support.categories[x.category]}</b><small>{x.org ? `${x.org} · ` : ""}{f.ago(new Date(x.updatedAt).getTime())}</small></span>
                  <span className="ok-pill" data-s={pill[x.status]}>{t.status[x.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {flash}
    </div>
  );
}
