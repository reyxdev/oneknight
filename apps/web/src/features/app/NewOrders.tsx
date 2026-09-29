"use client";

import { useEffect, useRef, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { playSound, unlockSound } from "@/lib/sound";
import { useToast } from "./Toasts";

type Fresh = { id: string; number: number; customerName: string; totalKop: number | null; items: { name: string; qty: number }[]; createdAt: string };
const POLL_MS = 15_000;
const SOUND_KEY = "ok.orderSound";

/** The new-order sound can be turned off on this device (Мій профіль → Сповіщення). On by default. */
export function orderSoundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setOrderSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {}
}

/**
 * While the panel is open: a new order plays its sound and opens a window with the number, sum, items and
 * customer, «Відкрити» / «Підтвердити». Several at once share one window. Also reports how many orders wait.
 */
export function NewOrders({ go, onCount }: { go: (screen: string, tab?: string) => void; onCount: (n: number) => void }) {
  const d = useDict();
  const t = d.app.newOrders;
  const lang = useLang();
  const toast = useToast();
  const [queue, setQueue] = useState<Fresh[]>([]);
  const since = useRef<string | null>(null);
  const count = useRef(onCount);
  count.current = onCount;

  useEffect(() => {
    // Browsers play sound only after the person touched the page once.
    window.addEventListener("pointerdown", unlockSound, { once: true });
    let live = true;
    const poll = async () => {
      const r = await api<{ now: string; newCount: number; orders: Fresh[] }>(`/shop/orders/fresh${since.current ? `?after=${encodeURIComponent(since.current)}` : ""}`);
      if (!live || !r.ok) return;
      since.current = r.data.now;
      count.current(r.data.newCount);
      if (r.data.orders.length) {
        setQueue((q) => [...q, ...r.data.orders.filter((o) => !q.some((x) => x.id === o.id))]);
        if (orderSoundOn()) playSound("order", { force: true });
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
      window.removeEventListener("pointerdown", unlockSound);
    };
  }, []);

  const done = (id: string) => setQueue((q) => q.filter((x) => x.id !== id));
  const confirm = async (o: Fresh) => {
    const r = await api(`/shop/orders/${o.id}`, { method: "PATCH", body: { status: "confirmed" } });
    done(o.id);
    if (!r.ok) return toast.show(r.error === "out_of_stock" ? d.app.orders.outOfStock : d.app.auth.errors.server_error, "warn");
    toast.undo(fmt(d.app.orders.statusChanged, { n: o.number, s: d.ok.orders.status.confirmed }), {
      undo: async () => {
        await api(`/shop/orders/${o.id}`, { method: "PATCH", body: { status: "new" } });
      },
    });
  };

  return (
    <Modal open={queue.length > 0} onClose={() => setQueue([])} labelledBy="ok-new-orders">
      <h2 id="ok-new-orders" className="app-neworders-title">{queue.length > 1 ? fmt(t.many, { n: queue.length }) : t.one}</h2>
      <ul className="app-neworders">
        {queue.map((o) => (
          <li key={o.id}>
            <div className="app-neworders-head">
              <b className="num">№{o.number}</b>
              <span className="ok-grow">{o.customerName}</span>
              {o.totalKop !== null && <b className="num">{formatUAH(o.totalKop / 100, lang)}</b>}
            </div>
            <p className="ok-muted">{o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</p>
            <div className="ok-actions">
              <button type="button" className="btn btn-sm" onClick={() => confirm(o)}>{t.confirm}</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => { done(o.id); go("orders", `o-${o.id}`); }}>{t.open}</button>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
