"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel } from "@/features/oneknight/ui/kit";

type Status = { available: boolean; bot: string | null; linked: boolean; username: string | null; kinds: string[] };
const KINDS = ["order", "review", "site", "billing", "ticket", "team"] as const;

/** Link the person's Telegram through the bot; while waiting for /start the status is re-read. */
export function TelegramPanel() {
  const t = useDict().app.telegram;
  const [st, setSt] = useState<Status | null>(null);
  const [waiting, setWaiting] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Status>("/telegram");
    if (r.ok) {
      setSt(r.data);
      if (r.data.linked) setWaiting(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(load, 3000);
    const stop = setTimeout(() => setWaiting(false), 15 * 60_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [waiting, load]);
  if (!st) return null;

  const connect = async () => {
    // Opened synchronously so popup blockers allow it; the address is set when the link arrives.
    const w = window.open("about:blank", "_blank");
    const r = await api<{ url: string }>("/telegram/link", { method: "POST", body: {} });
    if (!r.ok) {
      w?.close();
      return playSound("error");
    }
    if (w) w.location.href = r.data.url;
    else location.href = r.data.url;
    setWaiting(true);
  };
  const toggle = async (k: string) => {
    const kinds = st.kinds.includes(k) ? st.kinds.filter((x) => x !== k) : [...st.kinds, k];
    setSt({ ...st, kinds });
    const r = await api<Status>("/telegram", { method: "PATCH", body: { kinds } });
    if (r.ok) setSt((cur) => (cur ? { ...cur, kinds: r.data.kinds } : cur));
  };
  const disconnect = async () => {
    await api("/telegram", { method: "DELETE" });
    void load();
  };

  return (
    <Panel title={t.title}>
      <p className="ok-muted">{t.lead}</p>
      {!st.available ? (
        <p className="ok-note">{t.notConfigured}</p>
      ) : st.linked ? (
        <div className="ok-actions">
          <b>{fmt(t.linked, { who: st.username ? `@${st.username}` : "Telegram" })}</b>
          <button type="button" className="btn btn-sm btn-ghost" onClick={disconnect}>{t.disconnect}</button>
        </div>
      ) : (
        <div className="grid gap-2">
          <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={connect}>{t.connect}</button>
          {waiting && <p className="ok-muted" role="status">{t.waiting}</p>}
        </div>
      )}
      {st.available && (
        <>
          <div className="ok-sub">{t.kindsTitle}</div>
          <div className="ok-chips" role="group" aria-label={t.kindsTitle}>
            {KINDS.map((k) => (
              <button key={k} type="button" className="ok-chip" aria-pressed={st.kinds.includes(k)} onClick={() => toggle(k)}>{t.kinds[k]}</button>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
