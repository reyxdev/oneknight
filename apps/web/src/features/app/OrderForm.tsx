"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { formatPhone } from "./AuthScreen";
import type { OrderSettings } from "./Orders";

export const MANUAL_SOURCES = ["call", "instagram", "viber", "telegram", "facebook", "tiktok", "in_person"] as const;
const METHODS = ["novaposhta", "ukrposhta", "pickup", "courier"] as const;
const PAYS = ["cod", "iban", "card"] as const;

/** A line of the order: a catalogue product (price from the catalogue) or a free item with its own name and price. */
export type Line = { productId?: string; name: string; priceKop: number; qty: number };
export type OrderDraft = {
  customer: { name: string; phone: string; email: string };
  items: Line[];
  delivery: { method: string; city: string; branch: string; address: string };
  payment: string;
  source: string;
  comment: string;
  /** «Оформити замовлення» from an unfinished cart: the source is the cart. */
  cartId?: string;
};
export const emptyOrder = (): OrderDraft => ({
  customer: { name: "", phone: "+380 ", email: "" },
  items: [],
  delivery: { method: "novaposhta", city: "", branch: "", address: "" },
  payment: "cod",
  source: "call",
  comment: "",
});

/** The base: typing a name or phone suggests known customers; picking one fills the details and the last delivery. */
function CustomerSuggest({ q, onPick }: { q: string; onPick: (c: { name: string; phone: string | null; email: string | null; delivery: OrderDraft["delivery"] | null }) => void }) {
  const t = useDict().app.orderForm;
  const [found, setFound] = useState<{ id: string; name: string; phone: string | null; email: string | null; city: string | null; orders: number }[]>([]);
  const [closed, setClosed] = useState("");
  useEffect(() => {
    const s = q.trim();
    if (s.length < 3 || s === closed) return setFound([]);
    const timer = setTimeout(async () => {
      const r = await api<typeof found>(`/customers?q=${encodeURIComponent(s)}&limit=5`);
      if (r.ok) setFound(r.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, closed]);
  if (!found.length) return null;
  return (
    <ul className="app-picker-list app-inline" aria-label={t.fromBase}>
      {found.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={async () => {
              const r = await api<{ name: string; phone: string | null; email: string | null; delivery: OrderDraft["delivery"] | null }>(`/customers/${c.id}`);
              setClosed(q.trim());
              setFound([]);
              if (r.ok) onPick(r.data);
            }}
          >
            <Icon name="person" size={14} />
            <span className="ok-grow">{c.name}</span>
            <span className="num ok-muted">{c.phone}</span>
            {c.city && <small className="ok-muted">{c.city}</small>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Catalogue search for the order: name → product with its price and stock. */
function ProductPicker({ onPick }: { onPick: (p: { id: string; name: string; priceKop: number }) => void }) {
  const t = useDict().app.orderForm;
  const lang = useLang();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; priceKop: number; stock: number | null; active: boolean }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const timer = setTimeout(async () => {
      const r = await api<{ products: typeof found }>(`/shop/search?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setFound(r.data.products);
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <div className="app-picker">
      <Field label={t.findProduct}>{(p) => <input {...p} className="input" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      {found.length > 0 && (
        <ul className="app-picker-list">
          {found.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onPick(p); setQ(""); setFound([]); }}>
                <span className="ok-grow">{p.name}</span>
                <span className="num">{formatUAH(p.priceKop / 100, lang)}</span>
                <small className="ok-muted">{p.stock === null ? "∞" : p.stock}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * «+ Замовлення» and «Редагувати»: customer, items (catalogue or free), delivery, payment, source, comment.
 * When editing, payment and source are not changed here (payment has its own block, the source is history).
 */
export function OrderForm({ initial, edit, settings, onDone, onCancel }: { initial: OrderDraft; edit?: string; settings: OrderSettings | null; onDone: (id: string, number?: number) => void; onCancel: () => void }) {
  const d = useDict();
  const t = d.app.orderForm;
  const o = d.app.orders;
  const lang = useLang();
  const [f, setF] = useState(initial);
  const [free, setFree] = useState({ name: "", price: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = f.items.reduce((s, i) => s + i.priceKop * i.qty, 0);
  const setItem = (n: number, qty: number) => setF((x) => ({ ...x, items: qty < 1 ? x.items.filter((_, i) => i !== n) : x.items.map((it, i) => (i === n ? { ...it, qty } : it)) }));
  const sources = [...MANUAL_SOURCES, ...(settings?.sources ?? [])];
  const sourceName = (s: string) => (t.sources as Record<string, string>)[s] ?? s;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.customer.name.trim().length < 2) return setErr(t.errors.name);
    if (f.customer.phone.replace(/\D/g, "").length !== 12) return setErr(d.app.auth.errors.phoneFormat);
    if (!f.items.length) return setErr(t.errors.items);
    const body = {
      customer: { name: f.customer.name.trim(), phone: f.customer.phone.replace(/\s/g, ""), ...(f.customer.email.trim() ? { email: f.customer.email.trim() } : {}) },
      items: f.items.map((i) => (i.productId ? { productId: i.productId, qty: i.qty } : { name: i.name, price: i.priceKop / 100, qty: i.qty })),
      delivery: { method: f.delivery.method, ...Object.fromEntries((["city", "branch", "address"] as const).filter((k) => f.delivery[k].trim()).map((k) => [k, f.delivery[k].trim()])) },
      ...(edit ? { comment: f.comment.trim() || null } : { payment: f.payment, source: f.source, ...(f.cartId ? { cart: f.cartId } : {}), ...(f.comment.trim() ? { comment: f.comment.trim() } : {}) }),
    };
    setBusy(true);
    const r = edit ? await api(`/shop/orders/${edit}/edit`, { method: "PATCH", body }) : await api<{ id: string; number: number }>("/shop/orders", { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr((t.errors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error);
    }
    playSound("success");
    const created = r.data as { id: string; number: number } | null;
    onDone(edit ?? created!.id, created?.number);
  };

  return (
    <form className="grid gap-4 app-order-form" onSubmit={submit} noValidate>
      <fieldset className="app-q">
        <legend>{o.customer}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.name}>{(p) => <input {...p} className="input" autoComplete="off" value={f.customer.name} onChange={(e) => setF({ ...f, customer: { ...f.customer, name: e.target.value } })} />}</Field>
          <Field label={o.phone}>{(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="off" value={f.customer.phone} onChange={(e) => setF({ ...f, customer: { ...f.customer, phone: formatPhone(e.target.value) } })} />}</Field>
        </div>
        {!edit && (
          <CustomerSuggest
            q={f.customer.phone.replace(/\D/g, "").length > 5 ? f.customer.phone.replace(/\D/g, "").slice(3) : f.customer.name}
            onPick={(c) => setF((x) => ({ ...x, customer: { name: c.name, phone: c.phone ? formatPhone(c.phone) : x.customer.phone, email: c.email ?? "" }, delivery: c.delivery ? { method: c.delivery.method, city: c.delivery.city ?? "", branch: c.delivery.branch ?? "", address: c.delivery.address ?? "" } : x.delivery }))}
          />
        )}
        <Field label={t.email} optionalLabel={t.optional}>{(p) => <input {...p} className="input" type="email" autoComplete="off" value={f.customer.email} onChange={(e) => setF({ ...f, customer: { ...f.customer, email: e.target.value } })} />}</Field>
      </fieldset>

      <fieldset className="app-q">
        <legend>{o.items}</legend>
        {f.items.length > 0 && (
          <ul className="app-lines">
            {f.items.map((i, n) => (
              <li key={n}>
                <span className="ok-grow">{i.name}{!i.productId && <small className="ok-muted"> · {t.freeItem}</small>}</span>
                <span className="app-qty">
                  <button type="button" aria-label={t.less} onClick={() => setItem(n, i.qty - 1)}>−</button>
                  <b className="num">{i.qty}</b>
                  <button type="button" aria-label={t.more} onClick={() => setItem(n, i.qty + 1)}>+</button>
                </span>
                <span className="num">{formatUAH((i.priceKop * i.qty) / 100, lang)}</span>
              </li>
            ))}
            <li><b className="ok-grow">{o.total}</b><b className="num">{formatUAH(total / 100, lang)}</b></li>
          </ul>
        )}
        <ProductPicker onPick={(p) => setF((x) => ({ ...x, items: [...x.items, { productId: p.id, name: p.name, priceKop: p.priceKop, qty: 1 }] }))} />
        <div className="ok-form-row">
          <Field label={t.freeName}>{(p) => <input {...p} className="input" maxLength={200} value={free.name} onChange={(e) => setFree({ ...free, name: e.target.value })} />}</Field>
          <Field label={t.freePrice}>{(p) => <input {...p} className="input" inputMode="decimal" value={free.price} onChange={(e) => setFree({ ...free, price: e.target.value.replace(/[^\d.,]/g, "") })} />}</Field>
          <button type="button" className="btn btn-sm btn-secondary" disabled={!free.name.trim() || free.price === ""} onClick={() => { setF((x) => ({ ...x, items: [...x.items, { name: free.name.trim(), priceKop: Math.round(Number(free.price.replace(",", ".")) * 100), qty: 1 }] })); setFree({ name: "", price: "" }); }}><Icon name="plus" size={14} />{t.addFree}</button>
        </div>
      </fieldset>

      <fieldset className="app-q">
        <legend>{o.delivery}</legend>
        <div className="ok-chips" role="group" aria-label={o.delivery}>
          {METHODS.map((m) => <button key={m} type="button" className="ok-chip" aria-pressed={f.delivery.method === m} onClick={() => setF({ ...f, delivery: { ...f.delivery, method: m } })}>{o.methods[m]}</button>)}
        </div>
        {f.delivery.method !== "pickup" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.city}>{(p) => <input {...p} className="input" value={f.delivery.city} onChange={(e) => setF({ ...f, delivery: { ...f.delivery, city: e.target.value } })} />}</Field>
            {f.delivery.method === "courier" ? (
              <Field label={t.address}>{(p) => <input {...p} className="input" value={f.delivery.address} onChange={(e) => setF({ ...f, delivery: { ...f.delivery, address: e.target.value } })} />}</Field>
            ) : (
              <Field label={t.branch}>{(p) => <input {...p} className="input" value={f.delivery.branch} onChange={(e) => setF({ ...f, delivery: { ...f.delivery, branch: e.target.value } })} />}</Field>
            )}
          </div>
        )}
      </fieldset>

      {!edit && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={o.payment}>
            {(p) => (
              <select {...p} className="input" value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })}>
                {PAYS.map((x) => <option key={x} value={x}>{o.payments[x]}</option>)}
              </select>
            )}
          </Field>
          {f.cartId ? (
            <div className="ok-kv"><div><span>{t.source}</span><b>{o.sources.cart}</b></div></div>
          ) : (
            <Field label={t.source}>
              {(p) => (
                <select {...p} className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                  {sources.map((x) => <option key={x} value={x}>{sourceName(x)}</option>)}
                </select>
              )}
            </Field>
          )}
        </div>
      )}
      <Field label={o.comment} optionalLabel={t.optional}>{(p) => <textarea {...p} className="input" rows={2} maxLength={1000} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />}</Field>
      {err && <p className="field-error" role="alert">{err}</p>}
      <div className="ok-actions">
        <button className="btn btn-sm" type="submit" disabled={busy} data-loading={busy}>{edit ? t.saveEdit : t.create}</button>
        <button className="btn btn-sm btn-ghost" type="button" onClick={onCancel}>{t.cancel}</button>
      </div>
    </form>
  );
}
