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

type Hook = { id: string; url: string; events: string[]; active: boolean; disabledAt: string | null; createdAt: string; week: { ok: number; failed: number; pending: number } };
type Info = { owner: boolean; secretKey: { hint: string; createdAt: string; previousUntil: string | null } | null; events: string[]; max: number; webhooks: Hook[] };
type Delivery = { id: string; type: string; status: "pending" | "ok" | "failed"; attempts: number; lastStatus: number | null; lastError: string | null; nextAttemptAt: string; createdAt: string; deliveredAt: string | null };

/** A value shown once (a new key or a signing secret): copy it now, it is never shown again. */
function Once({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const t = useDict().app.siteApi;
  const toast = useToast();
  return (
    <div className="app-once" role="alert">
      <b>{label}</b>
      <code className="app-key">{value}</code>
      <p className="ok-muted">{t.onceNote}</p>
      <div className="ok-actions">
        <button type="button" className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(value); toast.show(t.copied); } catch { toast.show(t.copyFailed, "warn"); } }}><Icon name="copy" size={15} />{t.copy}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>{t.saved}</button>
      </div>
    </div>
  );
}

function Deliveries({ siteId, hook }: { siteId: string; hook: Hook }) {
  const t = useDict().app.siteApi;
  const f = useFormat();
  const [list, setList] = useState<Delivery[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<Delivery[]>(`/sites/${siteId}/webhooks/${hook.id}/deliveries`);
    if (r.ok) setList(r.data);
  }, [siteId, hook.id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!list) return null;
  if (!list.length) return <p className="ok-muted">{t.noDeliveries}</p>;
  return (
    <ul className="ok-list app-deliveries">
      {list.map((d) => (
        <li key={d.id} data-s={d.status}>
          <span className="app-cell-main">
            <b>{d.type}</b>
            <small>{f.dateTime(new Date(d.createdAt).getTime())} · {fmt(t.attempts, { n: d.attempts })}{d.lastStatus ? ` · HTTP ${d.lastStatus}` : ""}{d.lastError && !d.lastStatus ? ` · ${d.lastError}` : ""}{d.status === "pending" && d.attempts ? ` · ${fmt(t.nextAt, { at: f.dateTime(new Date(d.nextAttemptAt).getTime()) })}` : ""}</small>
          </span>
          <span className="ok-pill" data-s={d.status === "ok" ? "done" : d.status === "failed" ? "cancelled" : "new"}>{t.statuses[d.status]}</span>
          {d.status === "failed" && <button type="button" className="ok-link" onClick={async () => { await api(`/sites/${siteId}/webhooks/${hook.id}/deliveries/${d.id}/retry`, { method: "POST", body: {} }); void load(); }}>{t.retry}</button>}
        </li>
      ))}
    </ul>
  );
}

/**
 * «Сервер сайту»: the secret key for the site's own server (API /v1, owner creates it) and up to 3 webhook addresses
 * that hear about orders, stock and products — so the site updates itself.
 */
export function SiteServerApi({ siteId }: { siteId: string }) {
  const t = useDict().app.siteApi;
  const f = useFormat();
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [once, setOnce] = useState<{ label: string; value: string } | null>(null);
  const [form, setForm] = useState<{ url: string; events: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Info>(`/sites/${siteId}/api`);
    if (r.ok) setInfo(r.data);
  }, [siteId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!info) return null;
  const makeKey = async () => {
    if (info.secretKey && !confirm(t.replaceConfirm)) return;
    const r = await api<{ key: string }>(`/sites/${siteId}/secret-key`, { method: "POST", body: {} });
    if (!r.ok) return toast.show(t.error, "warn");
    setOnce({ label: t.newKey, value: r.data.key });
    void load();
  };
  const addHook = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const r = await api<{ secret: string }>(`/sites/${siteId}/webhooks`, { method: "POST", body: form });
    if (!r.ok) return toast.show(r.error === "too_many_webhooks" ? fmt(t.tooMany, { n: info.max }) : t.badUrl, "warn");
    setForm(null);
    setOnce({ label: t.newSecret, value: r.data.secret });
    void load();
  };
  return (
    <>
      <Panel title={t.keyTitle}>
        <p className="ok-muted">{t.keyLead}</p>
        {once && <Once label={once.label} value={once.value} onDone={() => setOnce(null)} />}
        {info.secretKey ? (
          <div className="ok-kv">
            <div><span>{t.key}</span><b className="num">{info.secretKey.hint}</b></div>
            <div><span>{t.created}</span><b>{f.dateTime(new Date(info.secretKey.createdAt).getTime())}</b></div>
            {info.secretKey.previousUntil && <div><span>{t.previous}</span><b>{fmt(t.previousUntil, { at: f.dateTime(new Date(info.secretKey.previousUntil).getTime()) })}</b></div>}
          </div>
        ) : (
          <p className="ok-muted">{t.noKey}</p>
        )}
        {info.owner ? (
          <div className="ok-actions">
            <button type="button" className="btn btn-sm" onClick={makeKey}><Icon name="lock" size={15} />{info.secretKey ? t.replace : t.create}</button>
            {info.secretKey && <button type="button" className="btn btn-sm btn-ghost ok-danger" onClick={async () => { if (!confirm(t.revokeConfirm)) return; await api(`/sites/${siteId}/secret-key`, { method: "DELETE" }); void load(); }}>{t.revoke}</button>}
          </div>
        ) : (
          <p className="ok-note"><Icon name="lock" size={14} /> {t.ownerOnly}</p>
        )}
        <pre className="app-code-block">{`GET ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/products\nAuthorization: Bearer ok_sec_…`}</pre>
      </Panel>

      <Panel title={t.hooksTitle} action={!form && info.webhooks.length < info.max ? <button type="button" className="btn btn-sm" onClick={() => setForm({ url: "https://", events: ["order.created", "order.status_changed", "stock.changed", "product.changed"] })}><Icon name="plus" size={15} />{t.add}</button> : undefined}>
        <p className="ok-muted">{t.hooksLead}</p>
        {form && (
          <form className="grid gap-3 app-hook-form" onSubmit={addHook}>
            <Field label={t.url} hint={t.urlHint}>{(p) => <input {...p} className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />}</Field>
            <fieldset className="app-q">
              <legend>{t.eventsTitle}</legend>
              <div className="ok-chips">
                {info.events.map((ev) => (
                  <button key={ev} type="button" className="ok-chip" aria-pressed={form.events.includes(ev)} onClick={() => setForm({ ...form, events: form.events.includes(ev) ? form.events.filter((x) => x !== ev) : [...form.events, ev] })}>{(t.events as Record<string, string>)[ev] ?? ev}</button>
                ))}
              </div>
            </fieldset>
            <div className="ok-actions">
              <button type="submit" className="btn btn-sm" disabled={!form.events.length}>{t.save}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)}>{t.cancel}</button>
            </div>
          </form>
        )}
        {info.webhooks.length === 0 && !form && <p className="ok-muted">{t.noHooks}</p>}
        <ul className="ok-list">
          {info.webhooks.map((h) => (
            <li key={h.id} className="app-hook" data-off={!h.active || undefined}>
              <div className="app-hook-head">
                <span className="app-cell-main">
                  <b className="app-hook-url">{h.url}</b>
                  <small>{h.events.map((ev) => (t.events as Record<string, string>)[ev] ?? ev).join(" · ")}</small>
                  <small>{fmt(t.week, { ok: h.week.ok, failed: h.week.failed, pending: h.week.pending })}{h.disabledAt ? ` · ${t.disabled}` : ""}</small>
                </span>
                <Toggle checked={h.active} onChange={async (v) => { await api(`/sites/${siteId}/webhooks/${h.id}`, { method: "PATCH", body: { active: v } }); void load(); }} label={t.active} />
              </div>
              <div className="ok-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { const r = await api<{ ok: boolean; status: number | null; body: string }>(`/sites/${siteId}/webhooks/${h.id}/test`, { method: "POST", body: {} }); if (r.ok) toast.show(r.data.ok ? fmt(t.testOk, { s: r.data.status ?? "" }) : fmt(t.testFail, { s: r.data.status ?? r.data.body }), r.data.ok ? "ok" : "warn"); }}><Icon name="send" size={15} />{t.test}</button>
                <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>{t.log}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { if (!confirm(t.secretConfirm)) return; const r = await api<{ secret: string }>(`/sites/${siteId}/webhooks/${h.id}/secret`, { method: "POST", body: {} }); if (r.ok) setOnce({ label: t.newSecret, value: r.data.secret }); }}>{t.newSecretBtn}</button>
                <button type="button" className="ok-link ok-danger" onClick={async () => { if (!confirm(t.removeConfirm)) return; await api(`/sites/${siteId}/webhooks/${h.id}`, { method: "DELETE" }); void load(); }}>{t.remove}</button>
              </div>
              {open === h.id && <Deliveries siteId={siteId} hook={h} />}
            </li>
          ))}
        </ul>
        <details className="app-hook-help">
          <summary>{t.howTitle}</summary>
          <p className="ok-muted">{t.how}</p>
          <pre className="app-code-block">{`POST <ваша адреса>
content-type: application/json
x-oneknight-event: order.created
x-oneknight-delivery: <id>
x-oneknight-signature: t=<секунди>,v1=<HMAC-SHA256(секрет, "t.тіло")>

{"id":"…","type":"order.created","createdAt":"…","siteId":"…","data":{"orderId":"…","number":1041,"status":"new","paymentStatus":"unpaid"}}`}</pre>
        </details>
      </Panel>
    </>
  );
}
