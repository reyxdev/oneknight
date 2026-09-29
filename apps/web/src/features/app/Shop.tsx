"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { readImage } from "@/lib/files";
import { playSound } from "@/lib/sound";
import { Empty, Panel, useFlash } from "@/features/oneknight/ui/kit";
import { useSites, type SiteInfo } from "./SiteScreen";
import { useToast } from "./Toasts";
import { Table, useEscClose, type Col, type Sort } from "./Table";

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

/** `tab` "new" opens the new-product form (Home quick action), "p-<id>" one product (search). */
export function ProductsScreen({ tab }: { tab?: string | null }) {
  const d = useDict();
  const t = d.app.products;
  const lang = useLang();
  const [flash, show] = useFlash();
  const { sites, site, picker } = useSitePicker();
  const [list, setList] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(tab === "new" ? "new" : tab?.startsWith("p-") ? tab.slice(2) : null);
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

  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  useEscClose(editing ? () => setEditing(null) : null);

  if (!sites) return null;
  if (!site) return <div className="ok-screen"><div className="ok-h"><h3>{t.title}</h3></div><Panel><p className="ok-muted">{t.noSite}</p></Panel></div>;
  const done = () => { setEditing(null); show(t.saved); void load(); };
  const rows = (list ?? []).filter((p) => !gone.includes(p.id));
  const current = editing && editing !== "new" ? rows.find((p) => p.id === editing) : null;
  const stockText = (p: Product) => (p.stock === null ? "∞" : p.stock === 0 ? t.outOfStock : String(p.stock));
  const cols: Col<Product>[] = [
    { key: "photo", label: t.photo, render: (p) => (p.photo ? <img className="app-thumb" src={p.photo} alt="" loading="lazy" /> : <span className="ok-thumb" style={{ ["--h" as string]: 200 }} />) },
    { key: "name", label: t.name, fixed: true, sort: (p) => p.name, render: (p) => <span className="app-cell-main"><b>{p.name}</b>{!p.active && <small>{t.hidden}</small>}</span> },
    { key: "price", label: t.price, align: "end", sort: (p) => p.price, render: (p) => <span className="num">{formatUAH(p.price, lang)}</span> },
    { key: "stock", label: t.stock, align: "end", sort: (p) => (p.stock === null ? Number.MAX_SAFE_INTEGER : p.stock), render: (p) => <span className="num" data-bad={p.stock === 0 || undefined}>{stockText(p)}</span> },
  ];
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t.add}</button>
      </div>
      {picker}
      <div className="ok-split" data-open={!!editing}>
        <Panel>
          {list && rows.length === 0 ? (
            <Empty icon="box" text={t.empty} />
          ) : (
            <Table id="products" label={t.title} rows={rows} cols={cols} active={editing} onOpen={(p) => setEditing(p.id)} sort={sort} onSort={setSort} page={page} onPage={setPage} />
          )}
        </Panel>
        {editing && (editing === "new" || current) && (
          <Panel
            className="ok-detail"
            title={editing === "new" ? t.add : current!.name}
            action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={() => setEditing(null)}><Icon name="close" size={16} /></button>}
          >
            <ProductForm
              key={editing}
              site={site}
              initial={editing === "new" ? empty : { id: current!.id, name: current!.name, description: current!.description, price: String(current!.price), stock: current!.stock === null ? "" : String(current!.stock), active: current!.active, photo: null, photoUrl: current!.photo }}
              onDone={done}
              onCancel={() => setEditing(null)}
            />
            {current && <button type="button" className="ok-link ok-danger" style={{ justifySelf: "start" }} onClick={() => { remove(current); setEditing(null); }}>{t.delete}</button>}
          </Panel>
        )}
      </div>
      {flash}
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
