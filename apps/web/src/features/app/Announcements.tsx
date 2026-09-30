"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";

type Item = { id: string; title: string; text: string; link: string | null };
type Data = { banner: Item | null; news: (Item & { at: string })[]; unread: number };

/** The banner above every screen and «Що нового» at the bottom of the menu. */
export function useAnnouncements() {
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(async () => {
    const r = await api<Data>("/announcements");
    if (r.ok) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 10 * 60_000);
    return () => clearInterval(id);
  }, [load]);
  return { data, load };
}

const Link = ({ href, label }: { href: string; label: string }) =>
  href.startsWith("#") ? <a className="btn btn-sm" href={href}>{label}</a> : <a className="btn btn-sm" href={href} target="_blank" rel="noopener">{label}</a>;

export function Banner({ item, onClose }: { item: Item; onClose: () => void }) {
  const t = useDict().app.news;
  return (
    <div className="app-banner" role="region" aria-label={t.banner}>
      <Icon name="megaphone" size={18} />
      <span className="ok-grow"><b>{item.title}</b>{item.text && <span> {item.text}</span>}</span>
      {item.link && <Link href={item.link} label={t.open} />}
      <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.close} onClick={async () => { await api(`/announcements/${item.id}/dismiss`, { method: "POST", body: {} }); onClose(); }}><Icon name="close" size={15} /></button>
    </div>
  );
}

export function NewsButton({ data, onSeen }: { data: Data; onSeen: () => void }) {
  const t = useDict().app.news;
  const f = useFormat();
  const [open, setOpen] = useState(false);
  if (!data.news.length) return null;
  return (
    <>
      <button type="button" className="ok-navbtn" onClick={async () => { setOpen(true); if (data.unread) { await api("/announcements/seen", { method: "POST", body: {} }); onSeen(); } }}>
        <Icon name="bolt" size={19} />
        <span>{t.title}</span>
        {data.unread > 0 && <span className="app-dot" aria-label={fmt(t.unread, { n: data.unread })}>{data.unread}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="ok-news">
        <div className="app-dialog grid gap-3">
          <h2 id="ok-news" className="app-neworders-title">{t.title}</h2>
          <ul className="app-news">
            {data.news.map((n) => (
              <li key={n.id}>
                <small className="ok-muted">{f.date(new Date(n.at).getTime())}</small>
                <b>{n.title}</b>
                {n.text && <p>{n.text}</p>}
                {n.link && <Link href={n.link} label={t.open} />}
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  );
}

type AdminItem = Item & { kind: "banner" | "news"; startsAt: string; endsAt: string | null; closed: number };

/** Admin: write a promotion banner (with dates) or a «Що нового» entry for everyone. */
export function AnnouncementsAdmin() {
  const t = useDict().app.newsAdmin;
  const f = useFormat();
  const [list, setList] = useState<AdminItem[] | null>(null);
  const [form, setForm] = useState({ kind: "news" as "banner" | "news", title: "", text: "", link: "", startsAt: "", endsAt: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<AdminItem[]>("/announcements/all");
    if (r.ok) setList(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api("/announcements", { method: "POST", body: { kind: form.kind, title: form.title, text: form.text, link: form.link, ...(iso(form.startsAt) ? { startsAt: iso(form.startsAt) } : {}), ...(form.endsAt ? { endsAt: iso(form.endsAt) } : {}) } });
    if (!r.ok) {
      playSound("error");
      return setErr(t.invalid);
    }
    playSound("success");
    setErr(null);
    setForm({ ...form, title: "", text: "", link: "", startsAt: "", endsAt: "" });
    void load();
  };
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.new}>
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <div className="ok-seg" role="radiogroup" aria-label={t.kind}>
            {(["news", "banner"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{t.kinds[k]}</button>)}
          </div>
          <Field label={t.titleField}>{(p) => <input {...p} className="input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label={t.text}>{(p) => <textarea {...p} className="input" rows={2} maxLength={1000} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />}</Field>
          <Field label={t.link} hint={t.linkHint}>{(p) => <input {...p} className="input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />}</Field>
          {form.kind === "banner" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.starts}>{(p) => <input {...p} className="input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />}</Field>
              <Field label={t.ends}>{(p) => <input {...p} className="input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />}</Field>
            </div>
          )}
          {err && <p className="field-error" role="alert">{err}</p>}
          <button className="btn btn-sm" type="submit" disabled={form.title.trim().length < 2} style={{ justifySelf: "start" }}>{t.publish}</button>
        </form>
      </Panel>
      <Panel title={t.list}>
        <ul className="ok-list">
          {(list ?? []).map((x) => (
            <li key={x.id}>
              <span className="ok-pill">{t.kinds[x.kind]}</span>
              <span className="ok-grow"><b>{x.title}</b><small className="ok-muted"> · {f.dateTime(new Date(x.startsAt).getTime())}{x.endsAt ? ` — ${f.dateTime(new Date(x.endsAt).getTime())}` : ""}{x.kind === "banner" ? ` · ${fmt(t.closed, { n: x.closed })}` : ""}</small></span>
              <button type="button" className="ok-link ok-danger" onClick={async () => { await api(`/announcements/${x.id}`, { method: "DELETE" }); void load(); }}>{t.remove}</button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
