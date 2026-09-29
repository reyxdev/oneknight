"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api, latestOnly } from "@/lib/api";
import { readImage } from "@/lib/files";
import { playSound } from "@/lib/sound";
import { Empty, Panel, StatusPill, useFlash, useFormat } from "@/features/oneknight/ui/kit";
import { useSites, type SiteInfo } from "./SiteScreen";
import { WaybillForm, WaybillPrint } from "./Waybill";
import { useToast } from "./Toasts";

type Product = { id: string; name: string; description: string; price: number; stock: number | null; active: boolean; photo: string | null };
type Draft = { name: string; description: string; price: string; stock: string; active: boolean; photo: { name: string; data: string } | null; photoUrl: string | null };
const empty: Draft = { name: "", description: "", price: "", stock: "", active: true, photo: null, photoUrl: null };

function useSitePicker() {
  const { sites } = useSites();
  const [sel, setSel] = useState(0);
  const site = sites?.[Math.min(sel, (sites?.length ?? 1) - 1)] ?? null;
  const picker =
    sites && sites.length > 1 ? (
      <div className="ok-chips">
        {sites.map((s, i) => (
          <button key={s.id} type="button" className="ok-chip" aria-pressed={i === sel} onClick={() => setSel(i)}>{s.domain}</button>
        ))}
      </div>
    ) : null;
  return { sites, site, picker };
}

function ProductForm({ site, initial, onDone, onCancel }: { site: SiteInfo; initial: Draft & { id?: string }; onDone: () => void; onCancel: () => void }) {
  const t = useDict().app.products;
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const price = Number(f.price.replace(",", "."));
    if (!f.name.trim() || !(price >= 0) || f.price === "") return setErr(t.errors.invalid_input);
    setBusy(true);
    const body = { name: f.name, description: f.description, price, stock: f.stock === "" ? null : Number(f.stock), active: f.active, ...(f.photo ? { photo: f.photo } : {}) };
    const r = initial.id ? await api(`/shop/products/${initial.id}`, { method: "PATCH", body }) : await api(`/shop/sites/${site.id}/products`, { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr((t.errors as Record<string, string>)[r.error] ?? t.errors.server_error);
    }
    playSound("success");
    onDone();
  };
  return (
    <form className="app-product-form" onSubmit={submit} noValidate>
      <label className="app-photo">
        {f.photo || f.photoUrl ? <img src={f.photo?.data ?? f.photoUrl!} alt="" /> : <span><Icon name="image" size={22} />{t.photoPick}</span>}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t.photo} onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const img = await readImage(file); setF((x) => ({ ...x, photo: img })); } }} />
      </label>
      <div className="grid gap-3">
        <Field label={t.name}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.price}>{(p) => <input {...p} className="input" inputMode="decimal" value={f.price} onChange={(e) => setF((x) => ({ ...x, price: e.target.value.replace(/[^\d.,]/g, "") }))} />}</Field>
          <Field label={t.stock} hint={t.stockHint}>{(p) => <input {...p} className="input" inputMode="numeric" value={f.stock} onChange={(e) => setF((x) => ({ ...x, stock: e.target.value.replace(/\D/g, "") }))} />}</Field>
        </div>
        <Field label={t.description}>{(p) => <textarea {...p} className="input" rows={3} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} />}</Field>
        <Toggle checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} label={t.active} />
        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="ok-actions">
          <button className="btn btn-sm" type="submit" disabled={busy} data-loading={busy}>{t.save}</button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onCancel}>{t.cancel}</button>
        </div>
      </div>
    </form>
  );
}

/** `tab` "new" opens the new-product form (Home quick action). */
export function ProductsScreen({ tab }: { tab?: string | null }) {
  const d = useDict();
  const t = d.app.products;
  const lang = useLang();
  const [flash, show] = useFlash();
  const { sites, site, picker } = useSitePicker();
  const [list, setList] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(tab === "new" ? "new" : null);
  const toast = useToast();
  // Deleted rows disappear at once; the product is really deleted after «Скасувати» had its 7 s.
  const [gone, setGone] = useState<string[]>([]);
  const remove = (p: Product) => {
    setGone((g) => [...g, p.id]);
    toast.undo(fmt(t.deleted, { name: p.name }), {
      undo: () => setGone((g) => g.filter((x) => x !== p.id)),
      commit: async () => {
        await api(`/shop/products/${p.id}`, { method: "DELETE", keepalive: true });
        void load();
      },
    });
  };
  const load = useCallback(async () => {
    if (!site) return;
    const r = await api<Product[]>(`/shop/sites/${site.id}/products`);
    if (r.ok) setList(r.data);
  }, [site]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!sites) return null;
  if (!site) return <div className="ok-screen"><div className="ok-h"><h3>{t.title}</h3></div><Panel><p className="ok-muted">{t.noSite}</p></Panel></div>;
  const done = () => { setEditing(null); show(t.saved); void load(); };
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        {editing === null && <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t.add}</button>}
      </div>
      {picker}
      {editing === "new" && <Panel><ProductForm site={site} initial={empty} onDone={done} onCancel={() => setEditing(null)} /></Panel>}
      <Panel>
        {list && list.length === 0 && editing !== "new" ? (
          <Empty icon="box" text={t.empty} />
        ) : (
          <ul className="ok-rows">
            {(list ?? []).filter((p) => !gone.includes(p.id)).map((p) =>
              editing === p.id ? (
                <li key={p.id}>
                  <ProductForm site={site} initial={{ id: p.id, name: p.name, description: p.description, price: String(p.price), stock: p.stock === null ? "" : String(p.stock), active: p.active, photo: null, photoUrl: p.photo }} onDone={done} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={p.id} className="ok-row ok-row-static">
                  {p.photo ? <img className="app-thumb" src={p.photo} alt="" loading="lazy" /> : <span className="ok-thumb" style={{ ["--h" as string]: 200 }} />}
                  <span className="ok-grow">
                    <b>{p.name}</b>
                    <small>{formatUAH(p.price, lang)} · {p.stock === null ? "∞" : p.stock === 0 ? t.outOfStock : `${t.stock}: ${p.stock}`}{!p.active ? ` · ${t.hidden}` : ""}</small>
                  </span>
                  <span className="ok-actions">
                    <button type="button" className="ok-link" onClick={() => setEditing(p.id)}>{t.edit}</button>
                    <button type="button" className="ok-link ok-danger" onClick={() => remove(p)}>{t.delete}</button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </Panel>
      {flash}
    </div>
  );
}

/** `totalKop` is null without «Фінанси». */
type OrderRow = { id: string; number: number; customerName: string; totalKop: number | null; status: Status; createdAt: string; source: string };
type Status = "new" | "confirmed" | "paid" | "shipped" | "done" | "cancelled";
type OrderFull = OrderRow & {
  externalId: string | null;
  waybillRef: string | null;
  customerPhone: string;
  customerEmail: string | null;
  items: { productId: string; name: string; qty: number; priceKop: number | null }[];
  delivery: { method: string; city?: string; branch?: string; address?: string };
  payment: string;
  comment: string | null;
  warranty: { enabled: boolean; until?: string; note?: string };
  waybill: string | null;
  events: { status: Status; at: string }[];
};
const FLOW: Status[] = ["new", "confirmed", "paid", "shipped", "done"];

function OrderDetail({ id, onChanged, shippingOnly }: { id: string; onChanged: () => void; shippingOnly: boolean }) {
  const d = useDict();
  const t = d.app.orders;
  const lang = useLang();
  const f = useFormat();
  const [flash, show] = useFlash();
  const toast = useToast();
  const [o, setO] = useState<OrderFull | null>(null);
  const [waybill, setWaybill] = useState("");
  const [w, setW] = useState({ enabled: false, until: "", note: "" });
  const load = useCallback(async () => {
    const r = await api<OrderFull>(`/shop/orders/${id}`);
    if (r.ok) {
      setO(r.data);
      setWaybill(r.data.waybill ?? "");
      setW({ enabled: r.data.warranty.enabled, until: r.data.warranty.until ?? "", note: r.data.warranty.note ?? "" });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!o) return null;
  const money = (k: number) => formatUAH(k / 100, lang);
  const patch = async (body: object, msg?: string) => {
    const r = await api(`/shop/orders/${id}`, { method: "PATCH", body });
    if (!r.ok) {
      playSound("error");
      show(r.error === "out_of_stock" ? t.outOfStock : d.app.auth.errors.server_error, "warn");
    } else {
      playSound("success");
      if (msg) show(msg);
    }
    void load();
    onChanged();
  };
  const next = FLOW[FLOW.indexOf(o.status) + 1];
  // Status changes apply at once; «Скасувати» (7 s) puts the previous one back.
  const setStatus = async (status: Status) => {
    const prev = o.status;
    const r = await api(`/shop/orders/${id}`, { method: "PATCH", body: { status } });
    if (!r.ok) {
      playSound("error");
      show(r.error === "out_of_stock" ? t.outOfStock : d.app.auth.errors.server_error, "warn");
    } else {
      playSound("success");
      toast.undo(fmt(t.statusChanged, { n: o.number, s: d.ok.orders.status[status] }), {
        undo: async () => {
          const back = await api(`/shop/orders/${id}`, { method: "PATCH", body: { status: prev } });
          if (!back.ok) show(back.error === "out_of_stock" ? t.outOfStock : d.app.auth.errors.server_error, "warn");
          void load();
          onChanged();
        },
      });
    }
    void load();
    onChanged();
  };
  return (
    <Panel className="ok-detail" title={<>#{o.number} · {o.customerName}</>}>
      <div className="ok-kv">
        <div><span>{d.ok.orders.state}</span><StatusPill status={o.status} /></div>
        <div><span>{d.ok.orders.date}</span><b>{f.dateTime(new Date(o.createdAt).getTime())}</b></div>
        {o.source !== "site" && <div><span>{d.app.analytics.sources}</span><b>{(t.sources as Record<string, string>)[o.source] ?? o.source}{o.externalId ? ` · №${o.externalId}` : ""}</b></div>}
        <div><span>{t.customer}</span><b><a className="ok-link" href={`tel:${o.customerPhone.replace(/[^\d+]/g, "")}`}>{o.customerPhone}</a>{o.customerEmail ? ` · ${o.customerEmail}` : ""}</b></div>
        <div><span>{t.delivery}</span><b>{t.methods[o.delivery.method as keyof typeof t.methods] ?? o.delivery.method}{[o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).length ? `: ${[o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).join(", ")}` : ""}</b></div>
        <div><span>{t.payment}</span><b>{t.payments[o.payment as keyof typeof t.payments] ?? o.payment}</b></div>
        {o.comment && <div><span>{t.comment}</span><b>{o.comment}</b></div>}
      </div>
      <div className="ok-sub">{t.items}</div>
      <ul className="ok-list">
        {o.items.map((i) => (
          <li key={i.productId}><span className="ok-grow">{i.name} × {i.qty}</span>{i.priceKop !== null && <span className="num">{money(i.priceKop * i.qty)}</span>}</li>
        ))}
        {o.totalKop !== null && <li><b className="ok-grow">{t.total}</b><b className="num">{money(o.totalKop)}</b></li>}
      </ul>
      {shippingOnly ? (
        (o.status === "confirmed" || o.status === "paid") && <div className="ok-actions"><button type="button" className="btn btn-sm" onClick={() => setStatus("shipped")}>{t.markShipped}</button></div>
      ) : (
      <div className="ok-actions">
        {next && o.status !== "cancelled" && <button type="button" className="btn btn-sm" onClick={() => setStatus(next)}>{d.ok.orders.next.replace("{s}", d.ok.orders.status[next])}</button>}
        <label className="ok-select">
          <span className="sr-only">{d.ok.orders.changeStatus}</span>
          <select value={o.status} onChange={(e) => setStatus(e.target.value as Status)}>
            {(Object.keys(d.ok.orders.status) as Status[]).map((k) => <option key={k} value={k}>{d.ok.orders.status[k]}</option>)}
          </select>
        </label>
      </div>
      )}
      {(o.delivery.method === "novaposhta" || o.delivery.method === "ukrposhta") && o.status !== "cancelled" && (
        o.waybillRef ? (
          <div className="ok-actions"><b className="num">{t.waybill}: {o.waybill}</b><WaybillPrint orderId={o.id} provider={o.delivery.method} /></div>
        ) : !o.waybill ? (
          <WaybillForm key={o.delivery.method} provider={o.delivery.method} orderId={o.id} notify={show} onCreated={() => { void load(); onChanged(); }} />
        ) : null
      )}
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void patch({ waybill: waybill.trim() || null, ...(shippingOnly ? {} : { warranty: { enabled: w.enabled, ...(w.until ? { until: w.until } : {}), ...(w.note ? { note: w.note } : {}) } }) }, t.saved); }}>
        <Field label={t.waybill}>{(p) => <input {...p} className="input" inputMode="numeric" value={waybill} onChange={(e) => setWaybill(e.target.value)} />}</Field>
        {!shippingOnly && <Toggle checked={w.enabled} onChange={(v) => setW({ ...w, enabled: v })} label={t.warrantyOn} />}
        {!shippingOnly && w.enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.warrantyUntil}>{(p) => <input {...p} className="input" type="date" value={w.until} onChange={(e) => setW({ ...w, until: e.target.value })} />}</Field>
            <Field label={t.warrantyNote}>{(p) => <input {...p} className="input" value={w.note} onChange={(e) => setW({ ...w, note: e.target.value })} />}</Field>
          </div>
        )}
        <button className="btn btn-sm btn-secondary" type="submit" style={{ justifySelf: "start" }}>{t.save}</button>
      </form>
      <div className="ok-sub">{t.history}</div>
      <ul className="ok-list">
        {o.events.map((e, i) => <li key={i}><StatusPill status={e.status} /><span className="ok-grow" /><small className="ok-muted">{f.dateTime(new Date(e.at).getTime())}</small></li>)}
      </ul>
      {flash}
    </Panel>
  );
}

const FILTERS = ["all", "new", "nowaybill", "confirmed", "paid", "shipped", "done", "cancelled"] as const;
/** «Комплектувальник» works only with orders waiting to be sent. */
const SHIP_FILTERS = ["all", "nowaybill", "confirmed", "paid", "shipped"] as const;
type Filter = (typeof FILTERS)[number];

/** `tab` from the address: a filter ("new", "nowaybill", …) or "o-<id>" to open one order (links from Home). */
export function OrdersScreen({ tab, shippingOnly = false }: { tab?: string | null; shippingOnly?: boolean }) {
  const d = useDict();
  const t = d.app.orders;
  const lang = useLang();
  const f = useFormat();
  const [filter, setFilter] = useState<Filter>((FILTERS as readonly string[]).includes(tab ?? "") ? (tab as Filter) : "all");
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(tab?.startsWith("o-") ? tab.slice(2) : null);
  const [next] = useState(latestOnly);
  const load = useCallback(async () => {
    const isLatest = next();
    const r = await api<OrderRow[]>(`/shop/orders${filter === "all" ? "" : `?status=${filter}`}`);
    if (r.ok && isLatest()) setRows(r.data);
  }, [filter, next]);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <div className="ok-chips" role="group" aria-label={d.ok.orders.state}>
        {(shippingOnly ? SHIP_FILTERS : FILTERS).map((x) => (
          <button key={x} type="button" className="ok-chip" aria-pressed={filter === x} onClick={() => setFilter(x)}>{x === "all" ? t.all : x === "nowaybill" ? t.noWaybill : d.ok.orders.status[x]}</button>
        ))}
      </div>
      <div className="ok-split" data-open={!!open}>
        <Panel>
          {rows && rows.length === 0 ? (
            <Empty icon="cart" text={t.empty} />
          ) : (
            <ul className="ok-rows">
              {(rows ?? []).map((o) => (
                <li key={o.id}>
                  <button type="button" className="ok-row" aria-current={open === o.id} onClick={() => setOpen(o.id)}>
                    <span className="num ok-muted">#{o.number}</span>
                    <span className="ok-grow"><b>{o.customerName}</b><small>{f.ago(new Date(o.createdAt).getTime())}{o.source !== "site" ? ` · ${(t.sources as Record<string, string>)[o.source] ?? o.source}` : ""}</small></span>
                    {o.totalKop !== null && <span className="num">{formatUAH(o.totalKop / 100, lang)}</span>}
                    <StatusPill status={o.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {open && <OrderDetail id={open} key={open} onChanged={load} shippingOnly={shippingOnly} />}
      </div>
    </div>
  );
}

/** Site key and a copy-ready example, shown on the Site screen. */
export function SiteApiPanel({ site, onRotated }: { site: SiteInfo & { publicKey?: string }; onRotated: () => void }) {
  const t = useDict().app.api;
  const [flash, show] = useFlash();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oneknight.pro";
  const sample = `fetch("${origin}/api/public/products", { headers: { "x-site-key": "${site.publicKey}" } })\n  .then((r) => r.json())`;
  return (
    <Panel title={t.title}>
      <p className="ok-muted">{t.lead}</p>
      <div className="ok-kv"><div><span>{t.key}</span><code className="app-key">{site.publicKey}</code></div></div>
      <details>
        <summary className="ok-link">{t.example}</summary>
        <pre className="app-code-block">{sample}</pre>
      </details>
      <button type="button" className="btn btn-sm btn-ghost" style={{ justifySelf: "start" }} onClick={async () => { const r = await api(`/shop/sites/${site.id}/rotate-key`, { method: "POST", body: {} }); if (r.ok) { show(t.rotated); onRotated(); } }}>{t.rotate}</button>
      {flash}
    </Panel>
  );
}
