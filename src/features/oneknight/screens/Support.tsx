"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { oneknightPricing } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { playSound } from "@/lib/sound";
import { useClient, useOkState } from "../state";
import { Empty, Panel, useFlash, useFormat } from "../ui/kit";
import type { TicketCategory } from "../domain";

export function Support() {
  const t = useDict().ok.support;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [cat, setCat] = useState<TicketCategory>("question");
  const [text, setText] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [flash, show] = useFlash();
  const h = oneknightPricing.supportResponseHours;

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot); }, [shot]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = client.createTicket(cat, text, !!shot);
    if (!r.ok) {
      setErr(true);
      playSound("error");
      return;
    }
    setErr(false);
    setText("");
    setShot(null);
    playSound("success");
    show(fmt(t.sent, { h }));
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.create}>
        <form className="ok-form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="label">{t.category}</span>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value as TicketCategory)}>
              {(Object.keys(t.categories) as TicketCategory[]).map((k) => (
                <option key={k} value={k}>{t.categories[k]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{t.text}</span>
            <textarea className="input" rows={4} value={text} aria-invalid={err ? true : undefined} onChange={(e) => setText(e.target.value)} />
            {err && <span className="field-error" role="alert">{t.invalid}</span>}
          </label>
          <div className="field">
            <span className="label">{t.screenshot}</span>
            {shot ? (
              <div className="ok-shot">
                <img src={shot} alt="" />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShot(null)}>{t.remove}</button>
              </div>
            ) : (
              <label className="btn btn-sm btn-secondary ok-file">
                <Icon name="image" size={16} />{t.attach}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) setShot(URL.createObjectURL(file)); }} />
              </label>
            )}
          </div>
          <div className="ok-actions">
            <button className="btn" type="submit"><Icon name="send" size={16} />{t.send}</button>
            <span className="ok-muted">{fmt(t.target, { h })}</span>
          </div>
        </form>
      </Panel>
      <Panel title={t.list}>
        {s.tickets.length === 0 ? (
          <Empty icon="chat" text={t.empty} />
        ) : (
          <ul className="ok-list">
            {s.tickets.map((x) => (
              <li key={x.id}>
                <span className="num ok-muted">#{x.number}</span>
                <span className="ok-grow"><b>{t.categories[x.category]}</b> <small className="ok-muted">{x.text.slice(0, 60)}</small></span>
                {x.screenshot && <Icon name="image" size={15} className="ok-muted" />}
                <span className="ok-pill" data-s="new">{t.status[x.status]}</span>
                <small className="ok-muted">{f.ago(x.at)}</small>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {flash}
    </div>
  );
}
