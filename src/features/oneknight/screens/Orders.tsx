"use client";

import { useState } from "react";
import { useDict } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { Icon } from "@/components/ui/Icon";
import { playSound } from "@/lib/sound";
import { useClient, useOkState } from "../state";
import { Empty, Panel, StatusPill, useFlash, useFormat } from "../ui/kit";
import { orderFlow, type OrderStatus } from "../domain";
import type { ScreenId } from "../ui/Shell";

const FILTERS: (OrderStatus | "all")[] = ["all", "new", "confirmed", "paid", "shipped", "done", "cancelled"];

export function Orders({ go }: { go: (s: ScreenId) => void }) {
  const t = useDict().ok.orders;
  const s = useOkState();
  const client = useClient();
  const f = useFormat();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setMsg] = useFlash();
  const list = s.orders.filter((o) => filter === "all" || o.status === filter);
  const open = s.orders.find((o) => o.id === openId) ?? null;
  const productName = (id: string) => s.products.find((p) => p.id === id)?.name ?? id;

  const setStatus = (id: string, st: OrderStatus) => {
    client.setOrderStatus(id, st);
    setMsg(t.updated);
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <div className="ok-chips" role="group" aria-label={t.state}>
        {FILTERS.map((x) => (
          <button key={x} type="button" className="ok-chip" aria-pressed={filter === x} onClick={() => setFilter(x)}>
            {x === "all" ? t.filterAll : t.status[x]}
            <span className="num">{x === "all" ? s.orders.length : s.orders.filter((o) => o.status === x).length}</span>
          </button>
        ))}
      </div>
      <div className="ok-split" data-open={!!open}>
        <Panel>
          {list.length === 0 ? (
            <Empty icon="cart" text={t.empty} />
          ) : (
            <ul className="ok-rows">
              {list.map((o) => (
                <li key={o.id}>
                  <button type="button" className="ok-row" aria-current={openId === o.id} onClick={() => setOpenId(o.id)} aria-label={`${t.open} #${o.number}`}>
                    <span className="num ok-muted">#{o.number}</span>
                    <span className="ok-grow"><b>{o.customer}</b><small>{f.ago(o.createdAt)}</small></span>
                    <span className="num">{f.money(o.total)}</span>
                    <StatusPill status={o.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {open && (
          <Panel
            className="ok-detail"
            title={<>#{open.number} · {open.customer}</>}
            action={<button type="button" className="ok-iconbtn" aria-label={t.close} onClick={() => setOpenId(null)}><Icon name="close" size={18} /></button>}
          >
            <div className="ok-kv">
              <div><span>{t.state}</span><StatusPill status={open.status} /></div>
              <div><span>{t.date}</span><b>{f.dateTime(open.createdAt)}</b></div>
              <div><span>{t.delivery}</span><b>{t.deliveryNames[open.delivery]}</b></div>
              <div><span>{t.payment}</span><b>{t.paymentNames[open.payment]}</b></div>
            </div>
            <div className="ok-sub">{t.items}</div>
            <ul className="ok-list">
              {open.items.map((it) => (
                <li key={it.productId}><span className="ok-grow">{productName(it.productId)} × {it.qty}</span><span className="num">{f.money(it.price * it.qty)}</span></li>
              ))}
              <li><b className="ok-grow">{t.total}</b><b className="num">{f.money(open.total)}</b></li>
            </ul>
            <div className="ok-actions">
              {open.status !== "cancelled" && open.status !== "done" && (
                <button type="button" className="btn btn-sm" data-sound="success" onClick={() => setStatus(open.id, orderFlow[orderFlow.indexOf(open.status) + 1]!)}>
                  {fmt(t.next, { s: t.status[orderFlow[orderFlow.indexOf(open.status) + 1]!] })}
                </button>
              )}
              <label className="ok-select">
                <span className="sr-only">{t.changeStatus}</span>
                <select value={open.status} onChange={(e) => setStatus(open.id, e.target.value as OrderStatus)}>
                  {(Object.keys(t.status) as OrderStatus[]).map((k) => (
                    <option key={k} value={k}>{t.status[k]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ok-sub">{t.waybill}</div>
            {open.waybill ? (
              <p><b className="num">{open.waybill}</b> <small className="ok-muted">{t.waybillDemo}</small></p>
            ) : (
              <div className="ok-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => {
                    const r = client.createWaybill(open.id);
                    if (!r.ok) {
                      playSound("error");
                      setMsg(t.waybillNeedsModule, "warn");
                    }
                  }}
                >
                  <Icon name="truck" size={16} />
                  {t.makeWaybill}
                </button>
                {!s.modules.some((m) => m.id === "novaposhta") && (
                  <button type="button" className="ok-link" onClick={() => go("modules")}>{t.waybillNeedsModule}</button>
                )}
              </div>
            )}
            <div className="ok-sub">{t.warranty}</div>
            <p className="ok-muted">{open.warranty.enabled ? open.warranty.note : t.warrantyNone}</p>
          </Panel>
        )}
      </div>
      {flash}
    </div>
  );
}
