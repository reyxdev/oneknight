"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { useFormat } from "@/features/oneknight/ui/kit";

type N = { id: string; kind: string; key: string; params: Record<string, string | number>; read: boolean; at: string };

/** Notification center. Polls every 30 s (a push channel replaces this later without UI changes). */
export function Bell() {
  const d = useDict().app.notif;
  const f = useFormat();
  const [items, setItems] = useState<N[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<N[]>("/notifications");
    if (!r.ok) return;
    const newest = r.data[0]?.id ?? null;
    if (seen.current && newest && newest !== seen.current && !r.data[0]!.read) playSound("notify");
    seen.current = newest;
    setItems(r.data);
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;
  const text = (n: N) => {
    const tpl = (d as Record<string, unknown>)[n.key];
    return typeof tpl === "string" ? fmt(tpl, n.params) : n.key;
  };
  const markAll = async () => {
    await api("/notifications/read", { method: "POST", body: {} });
    void load();
  };

  return (
    <div className="ok-bell" ref={ref}>
      <button type="button" className="ok-iconbtn" aria-label={`${d.title}: ${unread}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="bell" size={19} />
        {unread > 0 && <span className="ok-badge num" key={unread}>{unread}</span>}
      </button>
      {open && (
        <div className="ok-pop" role="dialog" aria-label={d.title}>
          <header>
            <b>{d.title}</b>
            <button type="button" className="ok-link" onClick={markAll} disabled={!unread}>{d.markAll}</button>
          </header>
          {items.length === 0 ? (
            <p className="ok-muted">{d.empty}</p>
          ) : (
            <ul>
              {items.slice(0, 10).map((n) => (
                <li key={n.id} data-read={n.read}>
                  <span>{text(n)}</span>
                  <small>{f.ago(new Date(n.at).getTime())}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
