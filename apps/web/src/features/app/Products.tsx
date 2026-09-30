"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { readImage } from "@/lib/files";
import { playSound } from "@/lib/sound";
import { Empty, Panel, useFormat } from "@/features/oneknight/ui/kit";
import { useSitePicker } from "./Shop";
import { useToast } from "./Toasts";
import { Table, useEscClose, type Col, type Sort } from "./Table";
import { openFile } from "./Orders";
import type { SiteInfo } from "./SiteScreen";

const AVAIL = ["in_stock", "to_order", "expected", "out"] as const;
type Avail = (typeof AVAIL)[number];
type Photo = { id: string; url: string };
export type Product = {
  id: string;
  name: string;
  description: string;
  sku: string | null;
  categoryId: string | null;
  price: number;
  oldPrice: number | null;
  cost: number | null;
  availability: Avail;
  state: Avail;
  orderDays: number | null;
  stock: number | null;
  lowStock: number | null;
  low: boolean;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  warrantyMonths: number | null;
  promote: "yes" | "no" | null;
  attributes: { name: string; value: string }[];
  active: boolean;
  archived: boolean;
  photo: string | null;
  photos: Photo[];
  photosLoading: number;
  sold30: number;
};
type Card = Product & {
  stats: { sold30: number; soldAll: number; revenue30Kop?: number; revenueAllKop?: number; profit30Kop?: number | null; profitAllKop?: number | null };
  events: { id: string; kind: string; changes: { field: string; from: unknown; to: unknown }[]; at: string; by: string | null }[];
};
type Category = { id: string; name: string; parentId: string | null; count: number };
type Cats = { categories: Category[]; none: number; all: number; archived: number };
type Filter = "all" | "none" | "archived" | string;

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Categories in tree order with their depth. */
function tree(cats: Category[]) {
  const out: (Category & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of cats.filter((x) => x.parentId === parent)) {
      out.push({ ...c, depth });
      if (depth < 4) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Left: «Усі», the category tree, «Без категорії», «Архів»; adding, renaming, moving and deleting categories. */
function CategoryTree({ site, cats, filter, onFilter, onChanged }: { site: SiteInfo; cats: Cats | null; filter: Filter; onFilter: (f: Filter) => void; onChanged: () => void }) {
  const t = useDict().app.products;
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<Category | null>(null);
  const toast = useToast();
  const rows = tree(cats?.categories ?? []);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await api(`/shop/sites/${site.id}/categories`, { method: "POST", body: { name: name.trim(), parentId: adding === "root" ? null : adding } });
    if (!r.ok) return toast.show(t.errors.server_error, "warn");
    setAdding(null);
    setName("");
    onChanged();
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const r = await api(`/shop/categories/${edit.id}`, { method: "PATCH", body: { name: edit.name.trim(), parentId: edit.parentId } });
    if (!r.ok) return toast.show(t.errors.invalid_input, "warn");
    setEdit(null);
    onChanged();
  };
  const remove = async (c: Category) => {
    await api(`/shop/categories/${c.id}`, { method: "DELETE" });
    setEdit(null);
    if (filter === c.id) onFilter("all");
    toast.show(fmt(t.catDeleted, { name: c.name }));
    onChanged();
  };
  const all = cats?.categories ?? [];
  const total = (id: string): number => (all.find((c) => c.id === id)?.count ?? 0) + all.filter((c) => c.parentId === id).reduce((s, c) => s + total(c.id), 0);
  const item = (f: Filter, label: string, count: number | undefined, depth = 0, c?: Category) => (
    <li key={f} style={{ ["--depth" as string]: depth }}>
      <button type="button" className="app-cat" aria-current={filter === f || undefined} onClick={() => onFilter(f)}>
        <span className="ok-grow">{label}</span>
        {count !== undefined && <small className="num">{count}</small>}
      </button>
      {c && <button type="button" className="app-cat-more" aria-label={fmt(t.catEdit, { name: c.name })} onClick={() => setEdit({ ...c })}><Icon name="settings" size={13} /></button>}
    </li>
  );
  return (
    <nav className="app-cats" aria-label={t.categories}>
      <ul>
        {item("all", t.allProducts, cats?.all)}
        {rows.map((c) => item(c.id, c.name, total(c.id), c.depth + 1, c))}
        {!!cats?.none && item("none", t.noCategory, cats.none)}
        {!!cats?.archived && item("archived", t.archive, cats.archived)}
      </ul>
      {adding ? (
        <form className="app-cat-form" onSubmit={add}>
          <input className="input" autoFocus aria-label={t.catName} placeholder={t.catName} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input" aria-label={t.catParent} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="root">{t.catTop}</option>
            {rows.map((c) => <option key={c.id} value={c.id}>{"· ".repeat(c.depth + 1)}{c.name}</option>)}
          </select>
          <div className="ok-actions">
            <button type="submit" className="btn btn-sm">{t.catAdd}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAdding(null)}>{t.cancel}</button>
          </div>
        </form>
      ) : (
        <button type="button" className="ok-link" onClick={() => setAdding("root")}><Icon name="plus" size={13} /> {t.catNew}</button>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} labelledBy="ok-cat-edit">
          <form className="app-dialog grid gap-4" onSubmit={save}>
            <h2 id="ok-cat-edit" className="app-neworders-title">{t.catEditTitle}</h2>
            <Field label={t.catName}>{(p) => <input {...p} className="input" maxLength={100} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
            <Field label={t.catParent}>
              {(p) => (
                <select {...p} className="input" value={edit.parentId ?? ""} onChange={(e) => setEdit({ ...edit, parentId: e.target.value || null })}>
                  <option value="">{t.catTop}</option>
                  {rows.filter((c) => c.id !== edit.id).map((c) => <option key={c.id} value={c.id}>{"· ".repeat(c.depth + 1)}{c.name}</option>)}
                </select>
              )}
            </Field>
            <div className="ok-actions">
              <button type="submit" className="btn btn-sm">{t.save}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>{t.cancel}</button>
              <button type="button" className="ok-link ok-danger" onClick={() => remove(edit)}>{t.catDelete}</button>
            </div>
            <p className="ok-muted">{t.catDeleteHint}</p>
          </form>
        </Modal>
      )}
    </nav>
  );
}

type Draft = {
  name: string; description: string; sku: string; categoryId: string; price: string; oldPrice: string; cost: string;
  availability: Avail; orderDays: string; stock: string; lowStock: string; weightG: string; lengthCm: string; widthCm: string; heightCm: string;
  warrantyMonths: string; attributes: { name: string; value: string }[]; active: boolean; promote: "yes" | "no" | null;
};
const draftOf = (p?: Product): Draft => ({
  name: p?.name ?? "", description: p?.description ?? "", sku: p?.sku ?? "", categoryId: p?.categoryId ?? "", price: str(p?.price), oldPrice: str(p?.oldPrice), cost: str(p?.cost),
  availability: p?.availability ?? "in_stock", orderDays: str(p?.orderDays), stock: str(p?.stock), lowStock: str(p?.lowStock), weightG: str(p?.weightG), lengthCm: str(p?.lengthCm), widthCm: str(p?.widthCm), heightCm: str(p?.heightCm),
  warrantyMonths: str(p?.warrantyMonths), attributes: p?.attributes ?? [], active: p?.active ?? true, promote: p?.promote ?? null,
});

/**
 * The gallery: several files at once, dragging to reorder (the first is the main photo), pasting from the clipboard,
 * removing. A new product keeps the chosen files until it is saved.
 */
function Gallery({ photos, queued, loading, onAdd, onOrder }: { photos: Photo[]; queued: { name: string; data: string }[]; loading: number; onAdd: (files: { name: string; data: string }[]) => void; onOrder: (ids: string[]) => void }) {
  const t = useDict().app.products;
  const drag = useRef<number | null>(null);
  const pick = async (list: FileList | File[]) => onAdd(await Promise.all([...list].filter((f) => f.type.startsWith("image/")).slice(0, 10).map(readImage)));
  return (
    <div className="app-gallery" onPaste={(e) => { if (e.clipboardData.files.length) void pick(e.clipboardData.files); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void pick(e.dataTransfer.files); } }}>
      {photos.map((p, i) => (
        <figure
          key={p.id}
          draggable
          onDragStart={() => (drag.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (drag.current === null || drag.current === i) return;
            e.preventDefault();
            e.stopPropagation();
            const ids = photos.map((x) => x.id);
            const [moved] = ids.splice(drag.current, 1);
            ids.splice(i, 0, moved!);
            drag.current = null;
            onOrder(ids);
          }}
        >
          <img src={p.url} alt="" />
          {i === 0 && <figcaption>{t.mainPhoto}</figcaption>}
          <div className="app-gallery-acts">
            {i > 0 && <button type="button" aria-label={t.makeMain} onClick={() => onOrder([p.id, ...photos.filter((x) => x.id !== p.id).map((x) => x.id)])}><Icon name="star" size={12} /></button>}
            <button type="button" aria-label={t.removePhoto} onClick={() => onOrder(photos.filter((x) => x.id !== p.id).map((x) => x.id))}><Icon name="close" size={12} /></button>
          </div>
        </figure>
      ))}
      {queued.map((q, i) => <figure key={`q${i}`}><img src={q.data} alt="" /></figure>)}
      {photos.length + queued.length < 10 && (
        <label className="app-photo app-gallery-add">
          <span><Icon name="image" size={22} />{t.photoPick}<small>{t.photoHint}</small></span>
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t.photo} onChange={(e) => { if (e.target.files) void pick(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      {loading > 0 && <p className="ok-muted">{fmt(t.photosLoading, { n: loading })}</p>}
    </div>
  );
}

function Editor({ site, product, cats, finance, content, onSaved, onCancel }: { site: SiteInfo; product: Product | null; cats: Category[]; finance: boolean; content: boolean; onSaved: (id: string) => void; onCancel: () => void }) {
  const d = useDict();
  const t = d.app.products;
  const lang = useLang();
  const [f, setF] = useState(() => draftOf(product ?? undefined));
  const [queued, setQueued] = useState<{ name: string; data: string }[]>([]);
  const [photos, setPhotos] = useState<Photo[]>(product?.photos ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const price = num(f.price);
  const cost = num(f.cost);
  const margin = finance && price !== null && cost !== null && price > 0 ? { sum: price - cost, pct: Math.round(((price - cost) / price) * 100) } : null;
  const errorText = (code: string) => (t.errors as Record<string, string>)[code] ?? t.errors.server_error;

  const addPhotos = async (files: { name: string; data: string }[]) => {
    if (!product) return setQueued((q) => [...q, ...files].slice(0, 10 - photos.length));
    for (const photo of files) {
      const r = await api<Product>(`/shop/products/${product.id}`, { method: "PATCH", body: { photo } });
      if (!r.ok) return setErr(errorText(r.error));
      setPhotos(r.data.photos);
    }
  };
  const order = async (ids: string[]) => {
    const r = await api<Product>(`/shop/products/${product!.id}/photos`, { method: "PUT", body: { ids } });
    if (r.ok) setPhotos(r.data.photos);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || price === null || !(price >= 0)) return setErr(t.errors.invalid_input);
    const body = {
      name: f.name.trim(), description: f.description, sku: f.sku.trim() || null, categoryId: f.categoryId || null, price, oldPrice: num(f.oldPrice),
      ...(finance ? { cost } : {}),
      availability: f.availability, orderDays: f.availability === "to_order" ? num(f.orderDays) : null,
      stock: f.availability === "to_order" ? null : num(f.stock), lowStock: num(f.lowStock),
      weightG: num(f.weightG), lengthCm: num(f.lengthCm), widthCm: num(f.widthCm), heightCm: num(f.heightCm), warrantyMonths: num(f.warrantyMonths),
      attributes: f.attributes.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), value: a.value.trim() })), active: f.active,
      ...(content ? { promote: f.promote } : {}),
    };
    setBusy(true);
    const r = product ? await api<Product>(`/shop/products/${product.id}`, { method: "PATCH", body }) : await api<Product>(`/shop/sites/${site.id}/products`, { method: "POST", body: { ...body, ...(queued[0] ? { photo: queued[0] } : {}) } });
    if (r.ok && !product) for (const photo of queued.slice(1)) await api(`/shop/products/${r.data.id}`, { method: "PATCH", body: { photo } });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      return setErr(errorText(r.error));
    }
    playSound("success");
    onSaved(r.data.id);
  };
  const numInput = (k: keyof Draft, label: string, hint?: string) => (
    <Field label={label} hint={hint}>{(p) => <input {...p} className="input" inputMode="decimal" value={f[k] as string} onChange={(e) => set(k, e.target.value.replace(/[^\d.,]/g, "") as never)} />}</Field>
  );
  return (
    <form className="grid gap-4 app-product-editor" onSubmit={submit} noValidate>
      <Gallery photos={photos} queued={queued} loading={product?.photosLoading ?? 0} onAdd={addPhotos} onOrder={order} />
      <fieldset className="app-q">
        <legend>{t.main}</legend>
        <Field label={t.name}>{(p) => <input {...p} className="input" maxLength={200} value={f.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.sku} optionalLabel={t.optional}>{(p) => <input {...p} className="input" maxLength={64} value={f.sku} onChange={(e) => set("sku", e.target.value)} />}</Field>
          <Field label={t.category}>
            {(p) => (
              <select {...p} className="input" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">{t.noCategory}</option>
                {tree(cats).map((c) => <option key={c.id} value={c.id}>{"· ".repeat(c.depth)}{c.name}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label={t.description}>{(p) => <textarea {...p} className="input" rows={3} maxLength={5000} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field>
        <Toggle checked={f.active} onChange={(v) => set("active", v)} label={t.active} />
      </fieldset>

      <fieldset className="app-q">
        <legend>{t.priceTitle}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {numInput("price", t.price)}
          {numInput("oldPrice", t.oldPrice, t.oldPriceHint)}
          {finance && numInput("cost", t.cost)}
        </div>
        {margin && <p className="ok-muted num">{fmt(t.margin, { sum: formatUAH(margin.sum, lang), pct: margin.pct })}</p>}
      </fieldset>

      <fieldset className="app-q">
        <legend>{t.availability}</legend>
        <div className="ok-chips" role="radiogroup" aria-label={t.availability}>
          {AVAIL.map((a) => <button key={a} type="button" role="radio" className="ok-chip" aria-checked={f.availability === a} aria-pressed={f.availability === a} onClick={() => set("availability", a)}>{t.states[a]}</button>)}
        </div>
        <p className="ok-muted">{t.statesHint[f.availability]}</p>
        {f.availability === "to_order" ? (
          numInput("orderDays", t.orderDays)
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {numInput("stock", t.stock, t.stockHint)}
            {numInput("lowStock", t.lowStock, t.lowStockHint)}
          </div>
        )}
      </fieldset>

      <fieldset className="app-q">
        <legend>{t.shipping}</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {numInput("weightG", t.weight)}
          {numInput("lengthCm", t.length)}
          {numInput("widthCm", t.width)}
          {numInput("heightCm", t.height)}
        </div>
        <p className="ok-muted">{t.shippingHint}</p>
        {numInput("warrantyMonths", t.warranty, t.warrantyHint)}
      </fieldset>

      {content && (
        <fieldset className="app-q">
          <legend>{t.promote}</legend>
          <div className="ok-chips" role="radiogroup" aria-label={t.promote}>
            {([null, "yes", "no"] as const).map((v) => <button key={String(v)} type="button" role="radio" className="ok-chip" aria-checked={f.promote === v} aria-pressed={f.promote === v} onClick={() => set("promote", v)}>{t.promotes[v ?? "auto"]}</button>)}
          </div>
          <p className="ok-muted">{t.promoteHint}</p>
        </fieldset>
      )}

      <fieldset className="app-q">
        <legend>{t.attributes}</legend>
        {f.attributes.map((a, i) => (
          <div key={i} className="app-attr">
            <input className="input" aria-label={t.attrName} placeholder={t.attrName} maxLength={100} value={a.name} onChange={(e) => set("attributes", f.attributes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input" aria-label={t.attrValue} placeholder={t.attrValue} maxLength={300} value={a.value} onChange={(e) => set("attributes", f.attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t.attrRemove} onClick={() => set("attributes", f.attributes.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
          </div>
        ))}
        {f.attributes.length < 50 && <button type="button" className="ok-link" style={{ justifySelf: "start" }} onClick={() => set("attributes", [...f.attributes, { name: "", value: "" }])}><Icon name="plus" size={13} /> {t.attrAdd}</button>}
      </fieldset>

      {err && <p className="field-error" role="alert">{err}</p>}
      <div className="ok-actions app-sticky-actions">
        <button className="btn btn-sm" type="submit" disabled={busy} data-loading={busy}>{t.save}</button>
        <button className="btn btn-sm btn-ghost" type="button" onClick={onCancel}>{t.cancel}</button>
      </div>
    </form>
  );
}

/** The product card: numbers of sales, the editor, history and the actions. */
function ProductCard({ id, site, cats, finance, content, onChanged, onClose, onOpen, onDelete }: { id: string; site: SiteInfo; cats: Category[]; finance: boolean; content: boolean; onChanged: () => void; onClose: () => void; onOpen: (id: string) => void; onDelete: (p: Product) => void }) {
  const d = useDict();
  const t = d.app.products;
  const lang = useLang();
  const f = useFormat();
  const toast = useToast();
  const [card, setCard] = useState<Card | null>(null);
  const load = useCallback(async () => {
    const r = await api<Card>(`/shop/products/${id}`);
    if (r.ok) setCard(r.data);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!card) return null;
  const money = (kop: number | null | undefined) => (kop === null || kop === undefined ? "—" : formatUAH(kop / 100, lang));
  const fieldName = (k: string) => (t.fields as Record<string, string>)[k] ?? k;
  const value = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k.endsWith("Kop") && typeof v === "number") return formatUAH(v / 100, lang);
    if (k === "availability") return (t.states as Record<string, string>)[String(v)] ?? String(v);
    if (k === "categoryId") return cats.find((c) => c.id === v)?.name ?? "—";
    if (k === "active") return v ? t.yes : t.no;
    if (Array.isArray(v)) return String(v.length);
    return String(v).slice(0, 60);
  };
  const act = async (url: string, body: object, done: string) => {
    const r = await api<Product>(url, { method: "POST", body });
    if (!r.ok) return toast.show(t.errors.server_error, "warn");
    toast.show(done);
    onChanged();
    return r.data;
  };
  const remove = () => {
    onDelete(card);
    onClose();
  };
  const toArchive = async () => {
    const p = await api<Product>(`/shop/products/${id}/archive`, { method: "POST", body: { archived: true } });
    if (!p.ok) return toast.show(t.errors.server_error, "warn");
    onClose();
    onChanged();
    toast.undo(fmt(t.archived, { name: card.name }), { undo: async () => { await api(`/shop/products/${id}/archive`, { method: "POST", body: { archived: false } }); onChanged(); } });
  };
  return (
    <Panel className="ok-detail" title={card.name} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <div className="ok-kv app-product-stats">
        <div><span>{t.sold30}</span><b className="num">{f.num(card.stats.sold30)} {t.pcs}</b></div>
        <div><span>{t.soldAll}</span><b className="num">{f.num(card.stats.soldAll)} {t.pcs}</b></div>
        {finance && <div><span>{t.revenue30}</span><b className="num app-secret">{money(card.stats.revenue30Kop)}</b></div>}
        {finance && <div><span>{t.profit30}</span><b className="num app-secret">{card.stats.profit30Kop === null ? t.noCost : money(card.stats.profit30Kop)}</b></div>}
      </div>
      {card.archived ? (
        <div className="ok-actions">
          <span className="ok-pill" data-s="cancelled">{t.inArchive}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => act(`/shop/products/${id}/archive`, { archived: false }, t.restored).then(load)}>{t.restore}</button>
          <button type="button" className="ok-link ok-danger" onClick={remove}>{t.delete}</button>
        </div>
      ) : (
        <Editor key={card.id + card.photos.length} site={site} product={card} cats={cats} finance={finance} content={content} onSaved={() => { toast.show(t.saved); onChanged(); void load(); }} onCancel={onClose} />
      )}
      {!card.archived && (
        <div className="ok-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { const p = await act(`/shop/products/${id}/duplicate`, {}, t.duplicated); if (p) onOpen(p.id); }}><Icon name="copy" size={14} />{t.duplicate}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={toArchive}>{t.toArchive}</button>
          <button type="button" className="ok-link ok-danger" onClick={remove}>{t.delete}</button>
        </div>
      )}
      <details className="app-history">
        <summary className="ok-link">{t.history} ({card.events.length})</summary>
        <ol className="app-timeline">
          {card.events.map((e) => (
            <li key={e.id}>
              <span className="app-timeline-what">
                {(t.eventKinds as Record<string, string>)[e.kind] ?? e.kind}
                {e.kind !== "duplicate" && e.changes.length > 0 && `: ${e.changes.map((c) => `${fieldName(c.field)} ${value(c.field, c.from)} → ${value(c.field, c.to)}`).join(", ")}`}
              </span>
              <small className="ok-muted">{f.dateTime(new Date(e.at).getTime())}{e.by ? ` · ${e.by}` : ""}</small>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}

type Preview = { created: number; updated: number; photos: number; errors: { line: number; error: string }[]; errorCount: number; total: number };
/** «Імпорт»: Excel (.xlsx / CSV) or Prom YML (file or link); first what will happen, then the import. */
function ImportDialog({ site, onClose, onDone }: { site: SiteInfo; onClose: () => void; onDone: () => void }) {
  const t = useDict().app.products;
  const toast = useToast();
  const [source, setSource] = useState<{ file?: { name: string; data: string }; url?: string } | null>(null);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (src: NonNullable<typeof source>, apply: boolean) => {
    setBusy(true);
    setErr(null);
    const r = await api<Preview>(`/shop/sites/${site.id}/products/import`, { method: "POST", body: { ...src, apply } });
    setBusy(false);
    if (!r.ok) return setErr((t.importErrors as Record<string, string>)[r.error] ?? t.errors.server_error);
    if (!apply) {
      setSource(src);
      return setPreview(r.data);
    }
    toast.show(fmt(t.imported, { created: r.data.created, updated: r.data.updated }));
    if (r.data.photos) toast.show(fmt(t.photosLater, { n: r.data.photos }));
    onDone();
    onClose();
  };
  const pick = async (file: File) => {
    const data = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
    await run({ file: { name: file.name, data } }, false);
  };
  return (
    <Modal open onClose={onClose} labelledBy="ok-import" wide>
      <div className="app-dialog grid gap-4">
        <h2 id="ok-import" className="app-neworders-title">{t.importTitle}</h2>
        {!preview ? (
          <>
            <p className="ok-muted">{t.importLead}</p>
            <div className="ok-actions">
              <label className="btn btn-sm">
                <Icon name="doc" size={15} />{t.importFile}
                <input type="file" accept=".xlsx,.csv,.xml,.yml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/xml" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void pick(file); }} />
              </label>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => openFile("/api/shop/products/template.xlsx", "oneknight-products-template.xlsx", false)}>{t.template}</button>
            </div>
            <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void run({ url: url.trim() }, false); }}>
              <Field label={t.ymlUrl} hint={t.ymlHint}>{(p) => <input {...p} className="input" type="url" inputMode="url" placeholder="https://…/export.yml" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
              <button type="submit" className="btn btn-sm btn-secondary" disabled={busy || !url.trim()} data-loading={busy}>{t.check}</button>
            </form>
            <p className="ok-muted">{t.importRules}</p>
          </>
        ) : (
          <>
            <ul className="ok-kv app-import-sum">
              <li><span>{t.willCreate}</span><b className="num">{preview.created}</b></li>
              <li><span>{t.willUpdate}</span><b className="num">{preview.updated}</b></li>
              <li><span>{t.withErrors}</span><b className="num">{preview.errorCount}</b></li>
              {preview.photos > 0 && <li><span>{t.photosToLoad}</span><b className="num">{preview.photos}</b></li>}
            </ul>
            {preview.errors.length > 0 && (
              <ul className="app-import-errors">
                {preview.errors.map((e, i) => <li key={i}>{e.line > 0 ? fmt(t.errorLine, { n: e.line }) : ""}{(t.rowErrors as Record<string, string>)[e.error] ?? e.error}</li>)}
              </ul>
            )}
            <div className="ok-actions">
              <button type="button" className="btn btn-sm" disabled={busy || preview.created + preview.updated === 0} data-loading={busy} onClick={() => source && run(source, true)}>{fmt(t.doImport, { n: preview.created + preview.updated })}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setPreview(null); setSource(null); }}>{t.back}</button>
            </div>
          </>
        )}
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/**
 * «Товари»: catalogue of a site. Categories on the left, a table or tiles, the card on the right. `tab`: "new" opens
 * the form (Home quick action), "p-<id>" one product (search), "low" / "out" the stock filters (Home).
 */
export function ProductsScreen({ tab, finance, content = false }: { tab?: string | null; finance: boolean; content?: boolean }) {
  const d = useDict();
  const t = d.app.products;
  const lang = useLang();
  const toast = useToast();
  const { sites, site, picker } = useSitePicker();
  const [cats, setCats] = useState<Cats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [stock, setStock] = useState<"all" | "low" | "out" | "hidden">(tab === "low" || tab === "out" ? tab : "all");
  const [q, setQ] = useState("");
  const [list, setList] = useState<Product[] | null>(null);
  const [open, setOpen] = useState<string | null>(tab === "new" ? "new" : tab?.startsWith("p-") ? tab.slice(2) : null);
  const [view, setView] = useState<"table" | "tiles">("table");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState({ percent: "", keepOld: true, category: "" });
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  // Deleting: the row goes at once, the product is really deleted after «Скасувати» had its 7 s; a product with
  // orders comes back with the advice to archive it.
  const [gone, setGone] = useState<string[]>([]);
  const remove = (p: Product) => {
    setGone((g) => [...g, p.id]);
    toast.undo(fmt(t.deleted, { name: p.name }), {
      undo: () => setGone((g) => g.filter((x) => x !== p.id)),
      commit: async () => {
        const r = await api(`/shop/products/${p.id}`, { method: "DELETE", keepalive: true });
        setGone((g) => g.filter((x) => x !== p.id));
        if (!r.ok) toast.show(r.error === "has_orders" ? fmt(t.hasOrders, { name: p.name }) : t.errors.server_error, "warn");
        void load();
      },
    });
  };
  useEffect(() => {
    try {
      if (localStorage.getItem("ok.products.view") === "tiles") setView("tiles");
    } catch {}
  }, []);
  const pickView = (v: "table" | "tiles") => {
    setView(v);
    try {
      localStorage.setItem("ok.products.view", v);
    } catch {}
  };
  const archived = filter === "archived";
  const load = useCallback(async () => {
    if (!site) return;
    const [p, c] = await Promise.all([api<Product[]>(`/shop/sites/${site.id}/products${archived ? "?archived=1" : ""}`), api<Cats>(`/shop/sites/${site.id}/categories`)]);
    if (p.ok) setList(p.data);
    if (c.ok) setCats(c.data);
  }, [site, archived]);
  useEffect(() => {
    void load();
  }, [load]);
  useEscClose(open ? () => setOpen(null) : null);

  if (!sites) return null;
  if (!site) return <div className="ok-screen"><div className="ok-h"><h3>{t.title}</h3></div><Panel><p className="ok-muted">{t.noSite}</p></Panel></div>;
  const categories = cats?.categories ?? [];
  // A category shows its subcategories' products too.
  const within = (id: string): string[] => [id, ...categories.filter((c) => c.parentId === id).flatMap((c) => within(c.id))];
  const inCat = filter === "all" || archived ? null : filter === "none" ? [] : within(filter);
  const needle = q.trim().toLowerCase();
  const rows = (list ?? []).filter(
    (p) =>
      !gone.includes(p.id) &&
      (inCat === null || (filter === "none" ? !p.categoryId : !!p.categoryId && inCat.includes(p.categoryId))) &&
      (stock === "all" || (stock === "low" ? p.low : stock === "out" ? p.state === "out" : !p.active)) &&
      (!needle || p.name.toLowerCase().includes(needle) || (p.sku ?? "").toLowerCase().includes(needle)),
  );
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "";
  const price = (p: Product) => (
    <span className="num app-price">
      {formatUAH(p.price, lang)}
      {p.oldPrice !== null && p.oldPrice > p.price && <s>{formatUAH(p.oldPrice, lang)}</s>}
    </span>
  );
  const state = (p: Product) => <span className="ok-pill" data-avail={p.state}>{p.state === "to_order" && p.orderDays ? fmt(t.toOrderDays, { n: p.orderDays }) : t.states[p.state]}</span>;
  const cols: Col<Product>[] = [
    { key: "photo", label: t.photo, render: (p) => (p.photo ? <img className="app-thumb" src={p.photo} alt="" loading="lazy" /> : <span className="ok-thumb" style={{ ["--h" as string]: 200 }} />) },
    { key: "name", label: t.name, fixed: true, sort: (p) => p.name, render: (p) => <span className="app-cell-main"><b>{p.name}</b>{!p.active && <small>{t.hidden}</small>}</span> },
    { key: "sku", label: t.sku, sort: (p) => p.sku ?? "", render: (p) => (p.sku ? <span className="num ok-muted">{p.sku}</span> : null) },
    { key: "price", label: t.price, align: "end", sort: (p) => p.price, render: price },
    { key: "stock", label: t.stock, align: "end", sort: (p) => (p.stock === null ? Number.MAX_SAFE_INTEGER : p.stock), render: (p) => <span className="num" data-bad={p.state === "out" || undefined} data-warn={p.low || undefined}>{p.stock === null ? "—" : p.stock}</span> },
    { key: "availability", label: t.availability, render: state },
    { key: "category", label: t.category, sort: (p) => catName(p.categoryId), render: (p) => <span className="ok-muted">{catName(p.categoryId)}</span> },
    { key: "sold", label: t.sold30, align: "end", sort: (p) => p.sold30, render: (p) => <span className="num">{p.sold30}</span> },
  ];
  const runBulk = async (action: object) => {
    const r = await api<{ done: number }>(`/shop/sites/${site.id}/products/bulk`, { method: "POST", body: { ids: selected, action } });
    if (!r.ok) return toast.show(t.errors.server_error, "warn");
    toast.show(fmt(t.bulkDone, { n: r.data.done }));
    setSelected([]);
    setBulk({ percent: "", keepOld: true, category: "" });
    void load();
  };
  const percent = num(bulk.percent.replace(/^\+/, ""));
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        <div className="ok-actions">
          <div className="ok-seg" role="radiogroup" aria-label={t.view}>
            {(["table", "tiles"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => pickView(v)}>{t.views[v]}</button>)}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setImporting(true)}><Icon name="upload" size={15} />{t.import}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => openFile(`/api/shop/sites/${site.id}/products/export.xlsx`, `products-${new Date().toISOString().slice(0, 10)}.xlsx`, false)}><Icon name="doc" size={15} />{t.excel}</button>
          <button type="button" className="btn btn-sm" onClick={() => setOpen("new")}><Icon name="plus" size={15} />{t.add}</button>
        </div>
      </div>
      {picker}
      <div className="app-products" data-open={!!open}>
        <CategoryTree site={site} cats={cats} filter={filter} onFilter={(x) => { setFilter(x); setPage(1); setSelected([]); }} onChanged={load} />
        <div className="grid gap-3" style={{ minWidth: 0 }}>
          <div className="ok-chips app-products-filters">
            <label className="app-search-inline">
              <Icon name="search" size={14} />
              <input className="input" type="search" aria-label={t.search} placeholder={t.search} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </label>
            {(["all", "low", "out", "hidden"] as const).map((x) => <button key={x} type="button" className="ok-chip" aria-pressed={stock === x} onClick={() => { setStock(x); setPage(1); }}>{t.stockFilters[x]}</button>)}
          </div>
          {selected.length > 0 && (
            <div className="app-bulk" role="region" aria-label={t.bulk}>
              <b>{fmt(d.app.orders.chosen, { n: selected.length })}</b>
              <form className="app-bulk-price" onSubmit={(e) => { e.preventDefault(); if (percent !== null && percent !== 0) void runBulk({ kind: "price", percent: bulk.percent.trim().startsWith("-") ? -Math.abs(percent) : percent, keepOld: bulk.keepOld }); }}>
                <input className="input" aria-label={t.bulkPercent} placeholder={t.bulkPercent} inputMode="decimal" value={bulk.percent} onChange={(e) => setBulk({ ...bulk, percent: e.target.value.replace(/[^\d.,+-]/g, "").slice(0, 6) })} />
                {bulk.percent.trim().startsWith("-") && <label className="ok-muted"><input type="checkbox" checked={bulk.keepOld} onChange={(e) => setBulk({ ...bulk, keepOld: e.target.checked })} /> {t.bulkKeepOld}</label>}
                <button type="submit" className="btn btn-sm btn-secondary" disabled={percent === null || percent === 0}>{t.bulkPrice}</button>
              </form>
              <label className="ok-select">
                <span className="sr-only">{t.bulkCategory}</span>
                <select value={bulk.category} onChange={(e) => { if (e.target.value) void runBulk({ kind: "category", categoryId: e.target.value === "none" ? null : e.target.value }); }}>
                  <option value="">{t.bulkCategory}</option>
                  <option value="none">{t.noCategory}</option>
                  {tree(categories).map((c) => <option key={c.id} value={c.id}>{"· ".repeat(c.depth)}{c.name}</option>)}
                </select>
              </label>
              {!archived && <button type="button" className="btn btn-sm btn-secondary" onClick={() => runBulk({ kind: "active", value: true })}>{t.bulkShow}</button>}
              {!archived && <button type="button" className="btn btn-sm btn-secondary" onClick={() => runBulk({ kind: "active", value: false })}>{t.bulkHide}</button>}
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => runBulk({ kind: "archive", value: !archived })}>{archived ? t.restore : t.toArchive}</button>
              <button type="button" className="ok-link" onClick={() => setSelected([])}>{d.app.orders.bulkClear}</button>
            </div>
          )}
          <div className="ok-split" data-open={!!open}>
            <Panel>
              {list && rows.length === 0 ? (
                <Empty icon="box" text={list.length ? t.nothingFound : archived ? t.archiveEmpty : t.empty} />
              ) : view === "tiles" ? (
                <ul className="app-tiles">
                  {rows.map((p) => (
                    <li key={p.id}>
                      <button type="button" aria-current={open === p.id || undefined} onClick={() => setOpen(p.id)}>
                        {p.photo ? <img src={p.photo} alt="" loading="lazy" /> : <span className="app-tile-empty"><Icon name="image" size={22} /></span>}
                        <b>{p.name}</b>
                        {price(p)}
                        {state(p)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Table id="products" label={t.title} rows={rows} cols={cols} active={open} onOpen={(p) => setOpen(p.id)} sort={sort} onSort={setSort} page={page} onPage={setPage} selected={selected} onSelect={setSelected} />
              )}
            </Panel>
            {open === "new" && (
              <Panel className="ok-detail" title={t.add} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={() => setOpen(null)}><Icon name="close" size={16} /></button>}>
                <Editor site={site} product={null} cats={categories} finance={finance} content={content} onSaved={(id) => { toast.show(t.saved); setOpen(id); void load(); }} onCancel={() => setOpen(null)} />
              </Panel>
            )}
            {open && open !== "new" && <ProductCard key={open} id={open} site={site} cats={categories} finance={finance} content={content} onChanged={load} onClose={() => setOpen(null)} onOpen={setOpen} onDelete={remove} />}
          </div>
        </div>
      </div>
      {importing && <ImportDialog site={site} onClose={() => setImporting(false)} onDone={load} />}
    </div>
  );
}
