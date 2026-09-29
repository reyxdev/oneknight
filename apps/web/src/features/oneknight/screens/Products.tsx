"use client";

import { useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { playSound } from "@/lib/sound";
import { useClient, useOkState } from "../state";
import { Empty, Panel, useFlash, useFormat } from "../ui/kit";

export function Products() {
  const t = useDict().ok.products;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState(false);
  const [flash, show] = useFlash();

  const add = (e: FormEvent) => {
    e.preventDefault();
    const r = client.addProduct(name, Number(price));
    if (!r.ok) {
      setErr(true);
      playSound("error");
      return;
    }
    setErr(false);
    setName("");
    setPrice("");
    playSound("success");
    show(t.added);
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel title={t.add}>
        <form className="ok-form-row" onSubmit={add} noValidate>
          <label className="field"><span className="label">{t.name}</span><input className="input" value={name} aria-invalid={err && !name.trim() ? true : undefined} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span className="label">{t.price}</span><input className="input" inputMode="numeric" value={price} aria-invalid={err && !(Number(price) > 0) ? true : undefined} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))} /></label>
          <button className="btn" type="submit"><Icon name="plus" size={16} />{t.save}</button>
        </form>
        {err && <p className="field-error" role="alert">{t.invalid}</p>}
      </Panel>
      <Panel>
        {s.products.length === 0 ? (
          <Empty icon="box" text={t.empty} />
        ) : (
          <ul className="ok-rows">
            {s.products.map((p) => (
              <li key={p.id} className="ok-row ok-row-static">
                <span className="ok-thumb" style={{ ["--h" as string]: 190 + p.photo * 24 }} />
                <span className="ok-grow"><b>{p.name}</b><small className="num">{f.money(p.price)}</small></span>
                <span className="ok-stepper">
                  <button type="button" aria-label={`${t.less}: ${p.name}`} onClick={() => client.adjustStock(p.id, -1)}>−</button>
                  <span className="num" data-low={p.stock <= 2}>{p.stock === 0 ? t.out : p.stock}</span>
                  <button type="button" aria-label={`${t.more}: ${p.name}`} onClick={() => client.adjustStock(p.id, 1)}>+</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {flash}
    </div>
  );
}
