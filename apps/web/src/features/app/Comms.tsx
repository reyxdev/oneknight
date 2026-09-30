"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";
import { AnnouncementsAdmin } from "./Announcements";
import { ContentAdmin } from "./ContentAdmin";
import { Tabs } from "./Tabs";
import { useToast } from "./Toasts";

const TABS = ["messages", "news", "ideas", "content"] as const;
type Broadcast = { id: string; title: string; text: string; segment: string; recipients: number; createdAt: string };
type Idea = { id: string; text: string; status: "new" | "planned" | "done" | "declined"; createdAt: string; org: string | null; by: string | null };

/** A message to all businesses or a segment: how many get it, «Тест собі» to Telegram, then send. */
function Messages() {
  const d = useDict();
  const t = d.app.comms;
  const f = useFormat();
  const toast = useToast();
  const [form, setForm] = useState({ title: "", text: "", segment: "all" });
  const [count, setCount] = useState<number | null>(null);
  const [data, setData] = useState<{ list: Broadcast[]; modules: string[] } | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ list: Broadcast[]; modules: string[] }>("/admin/broadcasts");
    if (r.ok) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api<{ recipients: number }>("/admin/broadcasts/count", { method: "POST", body: { segment: form.segment } }).then((r) => setCount(r.ok ? r.data.recipients : null));
  }, [form.segment]);
  const segName = (s: string) => (s.startsWith("module:") ? fmt(t.segModule, { m: (d.ok.modules.items as Record<string, { name?: string }>)[s.slice(7)]?.name ?? s.slice(7) }) : (t.segments as Record<string, string>)[s] ?? s);
  const valid = form.title.trim().length >= 3 && form.text.trim().length >= 3;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !confirm(fmt(t.confirm, { n: count ?? 0 }))) return;
    const r = await api("/admin/broadcasts", { method: "POST", body: { ...form, title: form.title.trim(), text: form.text.trim() } });
    if (!r.ok) return toast.show(r.error === "empty_segment" ? t.emptySegment : d.app.auth.errors.server_error, "warn");
    toast.show(fmt(t.sent, { n: count ?? 0 }));
    setForm({ ...form, title: "", text: "" });
    void load();
  };
  return (
    <>
      <Panel title={t.newMessage}>
        <form className="grid gap-3" onSubmit={send}>
          <Field label={t.segment}>
            {(p) => (
              <select {...p} className="input" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                {["all", "trial", "debt", ...(data?.modules ?? []).map((m) => `module:${m}`)].map((s) => <option key={s} value={s}>{segName(s)}</option>)}
              </select>
            )}
          </Field>
          <p className="ok-muted">{count === null ? "…" : fmt(t.recipients, { n: count })}</p>
          <Field label={t.title}>{(p) => <input {...p} className="input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label={t.text}>{(p) => <textarea {...p} className="input" rows={4} maxLength={2000} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />}</Field>
          {valid && (
            <div className="app-preview" aria-label={t.preview}>
              <small className="ok-muted">{t.preview}</small>
              <p><b>{form.title.trim()}</b></p>
              <p>{form.text.trim()}</p>
            </div>
          )}
          <div className="ok-actions">
            <button type="submit" className="btn btn-sm" disabled={!valid || !count}>{t.send}</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={!valid} onClick={async () => { const r = await api<{ sent: boolean }>("/admin/broadcasts/test", { method: "POST", body: form }); toast.show(r.ok && r.data.sent ? t.testSent : t.testFailed, r.ok && r.data.sent ? "ok" : "warn"); }}>{t.test}</button>
          </div>
          <p className="ok-muted">{t.how}</p>
        </form>
      </Panel>
      <Panel title={t.history}>
        {data && data.list.length === 0 ? (
          <p className="ok-muted">{t.historyEmpty}</p>
        ) : (
          <ul className="ok-list">
            {(data?.list ?? []).map((b) => (
              <li key={b.id}>
                <span className="ok-grow app-cell-main"><b>{b.title}</b><small>{b.text.slice(0, 140)}</small></span>
                <small className="ok-muted">{segName(b.segment)} · {fmt(t.recipients, { n: b.recipients })} · {f.dateTime(new Date(b.createdAt).getTime())}</small>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** Ideas from clients: set a status; «Зроблено» tells the business. */
function IdeasAdmin() {
  const d = useDict();
  const t = d.app.comms;
  const f = useFormat();
  const toast = useToast();
  const [list, setList] = useState<Idea[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<Idea[]>("/admin/ideas");
    if (r.ok) setList(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Panel title={t.ideasTitle}>
      {list && list.length === 0 ? (
        <p className="ok-muted">{t.ideasEmpty}</p>
      ) : (
        <ul className="ok-list">
          {(list ?? []).map((x) => (
            <li key={x.id}>
              <span className="ok-grow app-cell-main"><span>{x.text}</span><small>{[x.org, x.by, f.date(new Date(x.createdAt).getTime())].filter(Boolean).join(" · ")}</small></span>
              <label className="ok-select">
                <span className="sr-only">{t.ideaStatus}</span>
                <select value={x.status} onChange={async (e) => { const status = e.target.value; const r = await api(`/admin/ideas/${x.id}`, { method: "PATCH", body: { status } }); if (r.ok) { toast.show(status === "done" ? t.ideaDone : t.ideaSaved); void load(); } }}>
                  {(["new", "planned", "done", "declined"] as const).map((s) => <option key={s} value={s}>{d.app.ideas.status[s]}</option>)}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Admin «Комунікації»: messages to businesses, the banner and «Що нового», clients' ideas. */
export function CommsAdmin() {
  const t = useDict().app.comms;
  const [tab, setTab] = useState<(typeof TABS)[number]>("messages");
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.nav}</h3></div>
      <Tabs label={t.nav} value={tab} onChange={setTab} tabs={TABS.map((x) => ({ id: x, label: t.tabs[x] }))} />
      {tab === "messages" && <Messages />}
      {tab === "news" && <AnnouncementsAdmin embedded />}
      {tab === "ideas" && <IdeasAdmin />}
      {tab === "content" && <ContentAdmin />}
    </div>
  );
}
