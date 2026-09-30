"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { Panel, useFormat } from "@/features/oneknight/ui/kit";
import { useToast } from "./Toasts";

type Data = { code: string; invited: { name: string; at: string; rewarded: boolean }[]; months: number };

/** «Мій профіль → Реферали»: the person's link; a month free for both after the invited business pays. */
export function Referrals() {
  const t = useDict().app.referrals;
  const f = useFormat();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    void api<Data>("/referrals").then((r) => r.ok && setData(r.data));
  }, []);
  if (!data) return null;
  const link = `${location.origin}/app/?start=register&ref=${data.code}`;
  return (
    <Panel title={t.title}>
      <p className="ok-muted">{t.lead}</p>
      <div className="app-ref">
        <code>{link}</code>
        <button type="button" className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(link); toast.show(t.copied); } catch { toast.show(link); } }}><Icon name="link" size={14} />{t.copy}</button>
      </div>
      <div className="ok-stats">
        <div className="ok-stat"><span className="ok-stat-label">{t.invited}</span><b className="num">{data.invited.length}</b></div>
        <div className="ok-stat"><span className="ok-stat-label">{t.months}</span><b className="num">{data.months}</b></div>
      </div>
      {data.invited.length > 0 && (
        <ul className="ok-list">
          {data.invited.map((x, i) => (
            <li key={i}>
              <span className="ok-grow">{x.name}<small className="ok-muted"> · {f.date(new Date(x.at).getTime())}</small></span>
              <span className="ok-pill" data-pay={x.rewarded ? "paid" : undefined}>{x.rewarded ? t.rewarded : t.waiting}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="ok-muted">{fmt(t.rules, {})}</p>
    </Panel>
  );
}
