"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { api, latestOnly } from "@/lib/api";
import { StatusPill } from "@/features/oneknight/ui/kit";

type Result = {
  orders: { id: string; number: number; customerName: string; status: "new" | "confirmed" | "paid" | "shipped" | "done" | "cancelled" }[];
  products: { id: string; name: string; stock: number | null; active: boolean }[];
};
type Hit = { key: string; go: [string, string] };

/** Search box of the top bar: orders (number, name, phone) and products; «/» focuses it, ↑↓ Enter pick, Esc closes. */
export function Search({ go, inputRef }: { go: (screen: string, tab?: string) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const t = useDict().app.search;
  const id = useId();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [next] = useState(latestOnly);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const isLatest = next();
    const timer = setTimeout(async () => {
      const r = await api<Result>(`/shop/search?q=${encodeURIComponent(q.trim())}`);
      if (r.ok && isLatest()) {
        setRes(r.data);
        setActive(0);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q, next]);
  useEffect(() => {
    const out = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, []);

  const hits: Hit[] = res ? [...res.orders.map((o) => ({ key: o.id, go: ["orders", `o-${o.id}`] as [string, string] })), ...res.products.map((p) => ({ key: p.id, go: ["products", `p-${p.id}`] as [string, string] }))] : [];
  const pick = (h: Hit) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    go(...h.go);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQ("");
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      pick(hits[active]!);
    }
  };
  const show = open && q.trim().length >= 2 && res !== null;
  let i = -1;
  const option = (h: Hit, children: React.ReactNode) => {
    i++;
    const n = i;
    return (
      <li key={h.key} id={`${id}-${n}`} role="option" aria-selected={n === active} className="app-search-hit" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(h)} onPointerEnter={() => setActive(n)}>
        {children}
      </li>
    );
  };

  return (
    <div className="app-search" ref={box}>
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        type="search"
        className="app-search-input"
        placeholder={t.placeholder}
        aria-label={t.label}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-activedescendant={show && hits[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <kbd className="app-kbd" aria-hidden="true">/</kbd>
      {show && (
        <div className="app-search-pop">
          {hits.length === 0 ? (
            <p className="ok-muted">{t.empty}</p>
          ) : (
            <ul id={`${id}-list`} role="listbox" aria-label={t.label}>
              {res!.orders.length > 0 && <li role="presentation" className="app-search-group">{t.orders}</li>}
              {res!.orders.map((o) => option({ key: o.id, go: ["orders", `o-${o.id}`] }, <><span className="num ok-muted">№{o.number}</span><span className="ok-grow">{o.customerName}</span><StatusPill status={o.status} /></>))}
              {res!.products.length > 0 && <li role="presentation" className="app-search-group">{t.products}</li>}
              {res!.products.map((p) => option({ key: p.id, go: ["products", `p-${p.id}`] }, <><Icon name="box" size={15} /><span className="ok-grow">{p.name}</span>{!p.active && <small className="ok-muted">{t.hidden}</small>}</>))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
