"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { formatUAH } from "@/data/pricing";
import { api } from "@/lib/api";
import { Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";

type T = { id: string; org: string; amountKop: number; reference: string; status: "pending" | "confirmed" | "cancelled"; at: string };

/** Admin: bank transfers announced by clients. Confirm only after the money is on the account. */
export function TopupsAdmin() {
  const d = useDict();
  const t = d.app.topupsAdmin;
  const lang = useLang();
  const f = useFormat();
  const [flash, show] = useFlash();
  const [rows, setRows] = useState<T[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<T[]>("/admin/topups");
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (id: string, action: "confirm" | "cancel") => {
    const r = await api(`/admin/topups/${id}/${action}`, { method: "POST", body: {} });
    if (r.ok && action === "confirm") show(t.confirmed);
    void load();
  };
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel>
        {rows && rows.length === 0 ? (
          <p className="ok-muted">{t.empty}</p>
        ) : (
          <ul className="ok-list">
            {(rows ?? []).map((x) => (
              <li key={x.id}>
                <span className="ok-grow"><b className="num">{x.reference}</b><small>{x.org} · {f.dateTime(new Date(x.at).getTime())}</small></span>
                <b className="num">{formatUAH(x.amountKop / 100, lang)}</b>
                {x.status === "pending" ? (
                  <span className="ok-actions">
                    <button type="button" className="btn btn-sm" onClick={() => act(x.id, "confirm")}>{t.confirm}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(x.id, "cancel")}>{t.cancel}</button>
                  </span>
                ) : (
                  <span className="ok-pill" data-s={x.status === "confirmed" ? "done" : "cancelled"}>{d.app.billing.topupStatus[x.status]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {flash}
    </div>
  );
}
