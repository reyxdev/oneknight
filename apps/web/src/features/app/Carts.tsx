"use client";

import { useCallback, useEffect, useState } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { Empty, Panel, useFormat } from "@/features/oneknight/ui/kit";
import { Table, type Col, type Sort } from "./Table";
import { useToast } from "./Toasts";
import { ContactButtons } from "./Customers";
import { OrderForm, emptyOrder } from "./OrderForm";
import { formatPhone } from "./AuthScreen";
import { useSites } from "./SiteScreen";
import type { OrderSettings } from "./Orders";

type Cart = {
  id: string;
  phone: string;
  name: string | null;
  items: { productId: string; name: string; qty: number; priceKop: number | null }[];
  totalKop: number | null;
  orderId: string | null;
  recovered: boolean;
  closedAt: string | null;
  calls: number;
  callbackAt: string | null;
  note: string | null;
  updatedAt: string;
};
type Data = { view: View; stats: { abandoned: number; waiting: number; recovered: number; recoveredKop: number | null; self: number; keepDays: number }; carts: Cart[]; finance: boolean };
const VIEWS = ["waiting", "ordered", "closed"] as const;
type View = (typeof VIEWS)[number];

/** How a site hands its carts to ok.js, with the consent line that must stand under the phone field. */
function Setup({ open, keepDays }: { open: boolean; keepDays: number }) {
  const t = useDict().app.carts;
  const { sites } = useSites();
  const key = sites?.[0]?.publicKey ?? "sk_…";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oneknight.pro";
  return (
    <details className="app-carts-setup" open={open}>
      <summary className="ok-link">{t.setupTitle}</summary>
      <p className="ok-muted">{t.setup0}</p>
      <pre className="app-code-block">{`<script src="${origin}/ok.js" data-key="${key}" defer></script>`}</pre>
      <p className="ok-muted">{t.setup1}</p>
      <pre className="app-code-block">{`<input name="phone" type="tel" data-ok-phone>\n<small>${t.consent}</small>\n<input name="name" data-ok-name>`}</pre>
      <p className="ok-muted">{t.setup2}</p>
      <pre className="app-code-block">{`<form data-ok-cart='[{"id":"<id товару>","qty":2}]'>`}</pre>
      <p className="ok-muted">{t.setup3}</p>
      <pre className="app-code-block">{`oneknight.cart([{ id: "<id товару>", qty: 2 }])`}</pre>
      <p className="ok-muted"><Icon name="shield" size={14} /> {fmt(t.privacy, { days: keepDays })}</p>
    </details>
  );
}

/**
 * «Незавершені кошики»: the buyer put items in the cart and typed the phone on the site, but no order came within
 * 2 hours. The team calls: «Оформити замовлення» (the order counts as won back), «Не додзвонились» (again in 2 hours),
 * «Не цікаво». Buyers are not messaged automatically: that needs a paid Viber/SMS service (later).
 */
export function CartsView({ finance, settings, onOrder }: { finance: boolean; settings: OrderSettings | null; onOrder: (id: string, number: number) => void }) {
  const d = useDict();
  const t = d.app.carts;
  const lang = useLang();
  const f = useFormat();
  const toast = useToast();
  const [view, setView] = useState<View>("waiting");
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "when", dir: "desc" });
  const [page, setPage] = useState(1);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const r = await api<Data>(`/shop/carts?view=${view}`);
    if (r.ok) setData(r.data);
  }, [view]);
  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);
  const cart = data?.carts.find((c) => c.id === open) ?? null;
  useEffect(() => {
    setNote(cart?.note ?? "");
    setOrdering(false);
  }, [cart?.id, cart?.note]);

  const act = async (c: Cart, action: "no-answer" | "close" | "reopen" | "note", extra: object = {}) => {
    const r = await api<{ callbackAt: string | null }>(`/shop/carts/${c.id}`, { method: "POST", body: { action, ...extra } });
    void load();
    if (!r.ok) return toast.show(d.app.auth.errors.server_error, "warn");
    if (action === "no-answer") toast.show(t.noAnswerDone);
    if (action === "note") toast.show(t.saved);
    if (action === "close") {
      setOpen(null);
      toast.undo(t.closedDone, { undo: async () => { await api(`/shop/carts/${c.id}`, { method: "POST", body: { action: "reopen" } }); void load(); } });
    }
  };
  const money = (kop: number | null) => (kop === null ? null : <span className="num app-secret">{formatUAH(kop / 100, lang)}</span>);
  const what = (c: Cart) => c.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ");
  const cols: Col<Cart>[] = [
    { key: "customer", label: t.colCustomer, fixed: true, sort: (c) => c.name ?? "", render: (c) => <span className="app-cell-main"><b>{c.name || t.noName}</b><small className="num app-secret">{formatPhone(c.phone)}</small></span> },
    { key: "items", label: t.colItems, render: (c) => <span className="app-cell-clip">{what(c)}</span> },
    ...(finance ? [{ key: "total", label: t.colTotal, align: "end" as const, sort: (c: Cart) => c.totalKop ?? 0, render: (c: Cart) => money(c.totalKop) }] : []),
    { key: "when", label: t.colWhen, sort: (c) => new Date(c.updatedAt).getTime(), render: (c) => <span title={f.dateTime(new Date(c.updatedAt).getTime())}>{f.ago(new Date(c.updatedAt).getTime())}</span> },
    {
      key: "state",
      label: t.colState,
      render: (c) =>
        c.orderId ? (
          <span className="ok-pill" data-s="done">{c.recovered ? t.recovered : t.self}</span>
        ) : c.callbackAt && new Date(c.callbackAt).getTime() > Date.now() ? (
          <span className="ok-pill">{fmt(t.callAgain, { time: f.dateTime(new Date(c.callbackAt).getTime()) })}</span>
        ) : c.calls ? (
          <span className="ok-pill" data-s="shipped">{fmt(t.calls, { n: c.calls })}</span>
        ) : null,
    },
  ];
  const s = data?.stats;
  return (
    <>
      <p className="ok-muted">{t.lead}</p>
      {s && s.abandoned > 0 && (
        <p className="app-carts-stats">
          {fmt(t.stats, { days: s.keepDays, abandoned: s.abandoned, recovered: s.recovered, self: s.self })}
          {s.recoveredKop ? <> · {fmt(t.statsSum, { sum: formatUAH(s.recoveredKop / 100, lang) })}</> : null}
        </p>
      )}
      <div className="ok-chips" role="group" aria-label={t.tabCarts}>
        {VIEWS.map((v) => (
          <button key={v} type="button" className="ok-chip" aria-pressed={view === v} onClick={() => { setView(v); setOpen(null); setPage(1); }}>
            {t.views[v]}{v === "waiting" && s ? ` (${s.waiting})` : ""}
          </button>
        ))}
      </div>
      <div className="ok-split" data-open={!!cart}>
        <Panel>
          {data && data.carts.length === 0 ? (
            <Empty icon="cart" text={t.empty[view]} />
          ) : (
            <Table id="carts" label={t.tabCarts} rows={data?.carts ?? []} cols={cols} active={open} onOpen={(c) => setOpen(c.id)} sort={sort} onSort={setSort} page={page} onPage={setPage} />
          )}
        </Panel>
        {cart && (
          <Panel className="ok-detail" title={cart.name || t.noName} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={() => setOpen(null)}><Icon name="close" size={16} /></button>}>
            {ordering ? (
              <OrderForm
                initial={{ ...emptyOrder(), cartId: cart.id, customer: { name: cart.name ?? "", phone: formatPhone(cart.phone), email: "" }, items: cart.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, priceKop: i.priceKop ?? 0 })) }}
                settings={settings}
                onDone={(id, number) => { void load(); onOrder(id, number ?? 0); }}
                onCancel={() => setOrdering(false)}
              />
            ) : (
              <div className="grid gap-4">
                <ContactButtons phone={cart.phone} />
                <ul className="app-lines">
                  {cart.items.map((i) => (
                    <li key={i.productId}>
                      <span className="ok-grow">{i.name}</span>
                      <span className="num">×{i.qty}</span>
                      {i.priceKop !== null && money(i.priceKop * i.qty)}
                    </li>
                  ))}
                  {cart.totalKop !== null && <li><b className="ok-grow">{d.app.orders.total}</b><b>{money(cart.totalKop)}</b></li>}
                </ul>
                <div className="ok-kv">
                  <div><span>{t.colWhen}</span><b>{f.dateTime(new Date(cart.updatedAt).getTime())}</b></div>
                  {cart.calls > 0 && <div><span>{t.noAnswer}</span><b>{cart.calls}</b></div>}
                  {cart.callbackAt && !cart.orderId && <div><span>{t.callAgainAt}</span><b>{f.dateTime(new Date(cart.callbackAt).getTime())}</b></div>}
                </div>
                {cart.orderId ? (
                  <div className="ok-actions">
                    <span className="ok-pill" data-s="done">{cart.recovered ? t.recovered : t.self}</span>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOrder(cart.orderId!, 0)}>{t.openOrder}</button>
                  </div>
                ) : (
                  <>
                    <label className="grid gap-1">
                      <span className="ok-muted">{t.note}</span>
                      <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note.trim() !== (cart.note ?? "")) void act(cart, "note", { note: note.trim() }); }} />
                    </label>
                    <div className="ok-actions">
                      {cart.closedAt ? (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => act(cart, "reopen")}>{t.reopen}</button>
                      ) : (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setOrdering(true)}><Icon name="plus" size={15} />{t.order}</button>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => act(cart, "no-answer")}>{t.noAnswer}</button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(cart, "close")}>{t.close}</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Panel>
        )}
      </div>
      {data && <Panel><Setup open={data.stats.abandoned === 0} keepDays={data.stats.keepDays} /></Panel>}
    </>
  );
}
