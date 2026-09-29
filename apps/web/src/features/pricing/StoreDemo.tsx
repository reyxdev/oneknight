"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { featureIcon, storeTabs, type StoreTab } from "@/data/website-types";
import { playSound } from "@/lib/sound";

const PRODUCTS = [
  { id: 1, cat: "a", price: 240 },
  { id: 2, cat: "b", price: 180 },
  { id: 3, cat: "a", price: 320 },
  { id: 4, cat: "b", price: 150 },
  { id: 5, cat: "a", price: 410 },
  { id: 6, cat: "b", price: 260 },
] as const;
const VIEWS = [12, 18, 15, 22, 30, 26, 34];
const ORDERS = [1, 2, 1, 3, 4, 3, 5];

function Thumb({ n }: { n: number }) {
  return <div className="webpage-thumb" style={{ ["--h" as string]: 190 + n * 24 }} />;
}

export function StoreDemo() {
  const dict = useDict();
  const p = dict.pricing;
  const t = p.store;
  const [tab, setTab] = useState<StoreTab>("catalog");
  const [filter, setFilter] = useState<"all" | "a" | "b">("all");
  const [qty, setQty] = useState<Record<number, number>>({ 1: 1, 3: 2 });
  const [form, setForm] = useState({ name: "", phone: "" });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(false);
  const [pay, setPay] = useState(0);
  const [del, setDel] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const total = PRODUCTS.reduce((s, x) => s + (qty[x.id] ?? 0) * x.price, 0);
  const visible = PRODUCTS.filter((x) => filter === "all" || x.cat === filter);
  const maxViews = Math.max(...VIEWS);

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (storeTabs.indexOf(tab) + d + storeTabs.length) % storeTabs.length;
    setTab(storeTabs[i]!);
    refs.current[i]?.focus();
  };

  return (
    <div className="store card">
      <div className="store-head">
        <h3 className="h3">{t.title}</h3>
        <p className="small">{t.lead}</p>
      </div>
      <div className="store-body">
        <div className="store-tabs" role="tablist" aria-label={t.tabsLabel} aria-orientation="vertical" onKeyDown={onKey}>
          {storeTabs.map((k, i) => (
            <button
              key={k}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              id={`store-tab-${k}`}
              aria-selected={tab === k}
              aria-controls="store-panel"
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
            >
              <Icon name={featureIcon[k]} size={18} />
              {p.features[k]}
            </button>
          ))}
        </div>

        <div className="store-panel" role="tabpanel" id="store-panel" aria-labelledby={`store-tab-${tab}`}>
          <p className="store-cap">{t.captions[tab]}</p>
          <div className="store-screen" key={tab}>
            {(tab === "catalog" || tab === "filters") && (
              <>
                {tab === "filters" && (
                  <div className="store-chips" role="group" aria-label={p.features.filters}>
                    {(["all", "a", "b"] as const).map((f) => (
                      <button key={f} type="button" className="chip" data-on={filter === f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                        {f === "all" ? t.all : f === "a" ? t.catA : t.catB}
                      </button>
                    ))}
                  </div>
                )}
                <div className="store-grid">
                  {(tab === "catalog" ? PRODUCTS : visible).map((x) => (
                    <div key={x.id} className="webpage-item" data-pop>
                      <Thumb n={x.id} />
                      <b>{t.product} {x.id}</b>
                      <span className="small num">{x.price} {t.currency}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "cart" && (
              <div className="store-cart">
                {PRODUCTS.filter((x) => (qty[x.id] ?? 0) > 0 || x.id <= 3).slice(0, 3).map((x) => (
                  <div key={x.id} className="store-line">
                    <div className="store-line-thumb"><Thumb n={x.id} /></div>
                    <b>{t.product} {x.id}</b>
                    <div className="store-qty">
                      <button type="button" aria-label="−" onClick={() => setQty((q) => ({ ...q, [x.id]: Math.max(0, (q[x.id] ?? 0) - 1) }))}>−</button>
                      <span className="num" aria-live="polite">{qty[x.id] ?? 0}</span>
                      <button type="button" aria-label="+" onClick={() => setQty((q) => ({ ...q, [x.id]: (q[x.id] ?? 0) + 1 }))}>+</button>
                    </div>
                    <span className="num store-price">{(qty[x.id] ?? 0) * x.price}</span>
                  </div>
                ))}
                <div className="store-total"><span>{t.total}</span><b className="num">{total} {t.currency}</b></div>
              </div>
            )}

            {tab === "order" && (
              <form
                className="store-form"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.name.trim() || !form.phone.trim()) {
                    setErr(true);
                    playSound("error");
                    return;
                  }
                  setErr(false);
                  setSent(true);
                  playSound("success");
                }}
              >
                <label className="field"><span className="label">{t.name}</span><input className="input" value={form.name} aria-invalid={err && !form.name.trim() ? true : undefined} onChange={(e) => { setSent(false); setForm({ ...form, name: e.target.value }); }} /></label>
                <label className="field"><span className="label">{t.phone}</span><input className="input" type="tel" value={form.phone} aria-invalid={err && !form.phone.trim() ? true : undefined} onChange={(e) => { setSent(false); setForm({ ...form, phone: e.target.value }); }} /></label>
                {err && <p className="field-error" role="alert">{dict.common.required}</p>}
                <button className="btn" type="submit">{t.submit}</button>
                {sent && <p className="webpage-done" style={{ position: "static" }} role="status"><Icon name="check" size={16} /> {t.sent}</p>}
              </form>
            )}

            {(tab === "payment" || tab === "delivery") && (
              <div className="store-radios" role="radiogroup" aria-label={p.features[tab]}>
                {(tab === "payment" ? t.payMethods : t.delMethods).map((m, i) => {
                  const on = (tab === "payment" ? pay : del) === i;
                  return (
                    <button key={m} type="button" role="radio" aria-checked={on} onClick={() => (tab === "payment" ? setPay(i) : setDel(i))} data-sound="toggle">
                      <i aria-hidden="true" />
                      {m}
                    </button>
                  );
                })}
              </div>
            )}

            {tab === "analytics" && (
              <div className="store-an">
                <div className="store-kpis">
                  <div><b className="num">{VIEWS.reduce((a, b) => a + b, 0)}</b><span>{t.views}</span></div>
                  <div><b className="num">{ORDERS.reduce((a, b) => a + b, 0)}</b><span>{t.orders}</span></div>
                </div>
                <div className="store-bars" aria-hidden="true">
                  {VIEWS.map((v, i) => (
                    <i key={i} style={{ ["--h" as string]: v / maxViews, ["--i" as string]: i }} />
                  ))}
                </div>
              </div>
            )}

            {tab === "seo" && (
              <div className="store-seo">
                <span className="store-seo-url">vash-magazyn.ua › product</span>
                <b>{t.seoTitle}</b>
                <p>{t.seoDesc}</p>
              </div>
            )}

            {tab === "oneknight" && (
              <ul className="store-orders">
                {t.statuses.map((s, i) => (
                  <li key={s}>
                    <span className="num">#{1041 + i}</span>
                    <b>{t.order1}</b>
                    <span className="pill" data-s={i}>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p className="svc-note">{t.demoNote}</p>
    </div>
  );
}
