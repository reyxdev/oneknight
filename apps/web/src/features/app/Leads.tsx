"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { useModal } from "@/components/global/ModalProvider";
import { api } from "@/lib/api";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

export type LeadStatus = "new" | "in_progress" | "won" | "lost";
type MyLead = { id: string; number: number; service: string; siteType: string | null; status: LeadStatus; business: string; createdAt: string };

const pill: Record<LeadStatus, string> = { new: "new", in_progress: "shipped", won: "done", lost: "cancelled" };

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

type AdminLead = MyLead & { name: string; phone: string; email: string | null; source: string; brief: Record<string, unknown> };

/** Ivan's list of all requests. Visible only to platform admins (the API enforces it too). */
export function AdminLeads() {
  const d = useDict();
  const t = d.app.admin;
  const f = useFormat();
  const [flash, show] = useFlash();
  const { rows, error, load } = useLeads<AdminLead>("/admin/leads");
  const setStatus = async (id: string, status: LeadStatus) => {
    const r = await api(`/admin/leads/${id}`, { method: "PATCH", body: { status } });
    if (r.ok) {
      show(t.changed);
      void load();
    }
  };
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel>
        {error ? (
          <p className="ok-muted">{d.app.leads.loadError} <button type="button" className="ok-link" onClick={load}>{d.app.offline.retry}</button></p>
        ) : rows && rows.length === 0 ? (
          <p className="ok-muted">{t.empty}</p>
        ) : (
          <ul className="ok-reviews">
            {(rows ?? []).map((l) => (
              <li key={l.id} className="ok-review">
                <header>
                  <b>#{l.number} · {l.name}</b>
                  <a className="ok-link" href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a>
                  {l.email && <a className="ok-link" href={`mailto:${l.email}`}>{l.email}</a>}
                  <small className="ok-muted">{f.dateTime(new Date(l.createdAt).getTime())} · {t.source[l.source as keyof typeof t.source] ?? l.source}</small>
                </header>
                <p><b>{d.order.service[l.service as keyof typeof d.order.service] as string}{l.siteType && l.siteType !== "unsure" ? ` · ${d.siteTypes[l.siteType as keyof typeof d.siteTypes]}` : ""}</b>: {String(l.brief.business ?? "")}</p>
                {Boolean(l.brief.about) && <p className="ok-muted">{String(l.brief.about)}</p>}
                <label className="ok-select">
                  <span className="sr-only">{d.ok.orders.changeStatus}</span>
                  <select value={l.status} onChange={(e) => setStatus(l.id, e.target.value as LeadStatus)}>
                    {(Object.keys(d.app.leads.status) as LeadStatus[]).map((s) => (
                      <option key={s} value={s}>{d.app.leads.status[s]}</option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {flash}
    </div>
  );
}
