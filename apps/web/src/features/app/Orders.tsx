"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { Modal } from "@/components/ui/Modal";
import { api, latestOnly } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Empty, Panel, useFlash, useFormat } from "@/features/oneknight/ui/kit";
import { WaybillForm, WaybillPrint } from "./Waybill";
import { useToast } from "./Toasts";
import { PAGE, Table, useEscClose, type Col, type Sort } from "./Table";
import { OrderForm, emptyOrder, type OrderDraft } from "./OrderForm";

export type Group = "new" | "confirmed" | "shipped" | "done" | "cancelled" | "returned";
export const GROUPS: Group[] = ["new", "confirmed", "shipped", "done", "cancelled", "returned"];
type Payment = "unpaid" | "prepaid" | "paid" | "refunded";
const PAYMENTS: Payment[] = ["unpaid", "prepaid", "paid", "refunded"];
const PRESET_REASONS = ["changed_mind", "out_of_stock", "no_answer", "duplicate"] as const;

export type OrderSettings = { statuses: { id: string; name: string; group: Group }[]; reasons: string[]; sources: string[]; urgentHours: number; canEdit: boolean };

/** The business's own statuses, reasons and sources («Бізнес → Замовлення»). */
export function useOrderSettings() {
  const [s, setS] = useState<OrderSettings | null>(null);
  const load = useCallback(async () => {
    const r = await api<OrderSettings>("/shop/settings");
    if (r.ok) setS(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { settings: s, reload: load };
}

/** `totalKop` and `paymentStatus` are null without «Фінанси». */
type OrderRow = {
  id: string;
  number: number;
  customerName: string;
  customerPhone: string;
  totalKop: number | null;
  status: Group;
  statusId: string | null;
  paymentStatus: Payment | null;
  waybill: string | null;
  callbackAt: string | null;
  createdAt: string;
  source: string;
  isExample: boolean;
};
type Event = { kind: string; status: Group | null; data: Record<string, unknown> | null; at: string; by: string | null };
type OrderFull = OrderRow & {
  externalId: string | null;
  waybillRef: string | null;
  customerEmail: string | null;
  items: { productId: string; name: string; qty: number; priceKop: number | null }[];
  delivery: { method: string; city?: string; branch?: string; address?: string };
  payment: string;
  prepaidKop: number | null;
  cancelReason: string | null;
  comment: string | null;
  warranty: { enabled: boolean; until?: string; note?: string };
  assignee: string | null;
  duplicates: { id: string; number: number; status: Group; createdAt: string }[];
  events: Event[];
};

/** The group's name or the business's own status name, with the group's colour. */
export function StatusBadge({ status, statusId, settings }: { status: Group; statusId?: string | null; settings: OrderSettings | null }) {
  const d = useDict();
  const own = statusId ? settings?.statuses.find((s) => s.id === statusId) : null;
  return <span className="ok-pill" data-s={status}>{own?.name ?? d.ok.orders.status[status]}</span>;
}

/** A preset reason key («changed_mind») or the business's own text. */
function useReasonText() {
  const t = useDict().app.orders;
  return (r: string) => (t.reasons as Record<string, string>)[r] ?? r;
}

/** «Скасувати замовлення» needs a reason: a preset one, the business's own, or free text. */
function CancelDialog({ open, settings, onClose, onConfirm }: { open: boolean; settings: OrderSettings | null; onClose: () => void; onConfirm: (reason: string) => void }) {
  const t = useDict().app.orders;
  const text = useReasonText();
  const [pick, setPick] = useState("");
  const [other, setOther] = useState("");
  const options = [...PRESET_REASONS, ...(settings?.reasons ?? [])];
  const reason = pick === "other" ? other.trim() : pick;
  return (
    <Modal open={open} onClose={onClose} labelledBy="ok-cancel-order">
      <form
        className="app-dialog grid gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (reason) onConfirm(reason);
        }}
      >
        <h2 id="ok-cancel-order" className="app-neworders-title">{t.cancelTitle}</h2>
        <fieldset className="app-q">
          <legend>{t.cancelReason}</legend>
          <div className="grid gap-2">
            {[...options, "other"].map((r) => (
              <label key={r} className="app-radio">
                <input type="radio" name="reason" value={r} checked={pick === r} onChange={() => setPick(r)} />
                {r === "other" ? t.reasonOther : text(r)}
              </label>
            ))}
          </div>
          {pick === "other" && <Field label={t.reasonOtherText}>{(p) => <input {...p} className="input" maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} />}</Field>}
        </fieldset>
        <div className="ok-actions">
          <button className="btn btn-sm" type="submit" disabled={!reason}>{t.cancelConfirm}</button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onClose}>{t.cancelKeep}</button>
        </div>
      </form>
    </Modal>
  );
}

function History({ events }: { events: Event[] }) {
  const d = useDict();
  const t = d.app.orders;
  const f = useFormat();
  const lang = useLang();
  const reason = useReasonText();
  const sourceName = (s: string) => (d.app.orderForm.sources as Record<string, string>)[s] ?? (t.sources as Record<string, string>)[s] ?? s;
  return (
    <ol className="app-timeline">
      {events.map((e, i) => (
        <li key={i}>
          <span className="app-timeline-what">
            {e.kind === "status" && e.status && (
              <>
                <span className="ok-pill" data-s={e.status}>{(e.data?.name as string | undefined) ?? d.ok.orders.status[e.status]}</span>
                {typeof e.data?.reason === "string" && <small>{fmt(t.reasonShown, { r: reason(e.data.reason) })}</small>}
              </>
            )}
            {e.kind === "created" && <span>{fmt(t.ev.created, { s: sourceName(String(e.data?.source ?? "")) })}</span>}
            {e.kind === "comment" && <span className="app-comment">{String(e.data?.text ?? "")}</span>}
            {e.kind === "assign" && <span>{t.ev.assign}</span>}
            {e.kind === "call" && <span>{t.ev.noAnswer}</span>}
            {e.kind === "merge" && <span>{fmt(t.ev.merge, { n: String(e.data?.number ?? "") })}</span>}
            {e.kind === "edit" && (
              <span>
                {t.ev.edit}:{" "}
                {Object.keys(e.data ?? {}).map((k) => (t.ev.fields as Record<string, string>)[k] ?? k).join(", ")}
                {(e.data?.items as { to?: string[] } | undefined)?.to && <small> → {(e.data!.items as { to: string[] }).to.join(", ")}</small>}
              </span>
            )}
            {e.kind === "payment" && (
              <span>
                {t.paymentChanged}: <b>{t.paymentStates[(e.data?.paymentStatus as Payment) ?? "unpaid"]}</b>
                {typeof e.data?.prepaidKop === "number" && <span className="app-secret"> · {formatUAH(e.data.prepaidKop / 100, lang)}</span>}
              </span>
            )}
          </span>
          <small className="ok-muted">{f.dateTime(new Date(e.at).getTime())}{e.by ? ` · ${e.by}` : ""}</small>
        </li>
      ))}
    </ol>
  );
}

function OrderDetail({ id, onChanged, shippingOnly, settings, meName, onClose }: { id: string; onChanged: () => void; shippingOnly: boolean; settings: OrderSettings | null; meName: string; onClose: () => void }) {
  const d = useDict();
  const t = d.app.orders;
  const lang = useLang();
  const f = useFormat();
  const [flash, show] = useFlash();
  const toast = useToast();
  const reasonText = useReasonText();
  const [o, setO] = useState<OrderFull | null>(null);
  const [waybill, setWaybill] = useState("");
  const [w, setW] = useState({ enabled: false, until: "", note: "" });
  const [cancelling, setCancelling] = useState<{ statusId: string | null } | null>(null);
  const [prepaid, setPrepaid] = useState("");
  const [askPrepaid, setAskPrepaid] = useState(false);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const load = useCallback(async () => {
    const r = await api<OrderFull>(`/shop/orders/${id}`);
    if (r.ok) {
      setO(r.data);
      setWaybill(r.data.waybill ?? "");
      setW({ enabled: r.data.warranty.enabled, until: r.data.warranty.until ?? "", note: r.data.warranty.note ?? "" });
      setPrepaid(r.data.prepaidKop ? String(r.data.prepaidKop / 100) : "");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!o) return null;
  const money = (k: number) => formatUAH(k / 100, lang);
  const errText = (e: string) => (e === "out_of_stock" ? t.outOfStock : e === "invalid_prepaid" ? t.invalidPrepaid : d.app.auth.errors.server_error);
  const refresh = () => {
    void load();
    onChanged();
  };
  const patch = async (body: object, msg?: string) => {
    const r = await api(`/shop/orders/${id}`, { method: "PATCH", body });
    if (!r.ok) {
      playSound("error");
      show(errText(r.error), "warn");
    } else {
      playSound("success");
      if (msg) show(msg);
    }
    refresh();
    return r.ok;
  };
  // Status changes apply at once; «Скасувати» (7 s) puts the previous one back.
  const changeStatus = async (to: { status: Group; statusId: string | null }, reason?: string) => {
    const prev = { status: o.status, statusId: o.statusId };
    const r = await api(`/shop/orders/${id}`, { method: "PATCH", body: { ...to, ...(reason ? { reason } : {}) } });
    if (!r.ok) {
      playSound("error");
      show(errText(r.error), "warn");
    } else {
      playSound("success");
      const name = (to.statusId && settings?.statuses.find((s) => s.id === to.statusId)?.name) || d.ok.orders.status[to.status];
      toast.undo(fmt(t.statusChanged, { n: o.number, s: name }), {
        undo: async () => {
          const back = await api(`/shop/orders/${id}`, { method: "PATCH", body: prev });
          if (!back.ok) show(errText(back.error), "warn");
          refresh();
        },
      });
    }
    refresh();
  };
  const pickStatus = (value: string) => {
    const [kind, v] = value.split(":") as ["g" | "s", string];
    const own = kind === "s" ? settings?.statuses.find((s) => s.id === v) : null;
    const to = { status: (own?.group ?? v) as Group, statusId: own?.id ?? null };
    // Cancelling asks for the reason in its own window.
    if (to.status === "cancelled" && o.status !== "cancelled") return setCancelling({ statusId: to.statusId });
    void changeStatus(to);
  };
  const current = o.statusId ? `s:${o.statusId}` : `g:${o.status}`;
  const editable = !shippingOnly && !o.isExample && (o.status === "new" || o.status === "confirmed");
  const post = async (path: string, body?: object, msg?: string) => {
    const r = await api(`/shop/orders/${id}/${path}`, { method: "POST", body: body ?? {} });
    if (!r.ok) {
      playSound("error");
      show(d.app.auth.errors.server_error, "warn");
    } else if (msg) show(msg);
    refresh();
    return r.ok;
  };
  const draft = (): OrderDraft => ({
    customer: { name: o.customerName, phone: o.customerPhone, email: o.customerEmail ?? "" },
    // Free items («довільний товар») have no catalogue id.
    items: o.items.map((i) => ({ ...(/^[0-9a-f-]{36}$/.test(i.productId) ? { productId: i.productId } : {}), name: i.name, priceKop: i.priceKop ?? 0, qty: i.qty })),
    delivery: { method: o.delivery.method, city: o.delivery.city ?? "", branch: o.delivery.branch ?? "", address: o.delivery.address ?? "" },
    payment: o.payment,
    source: o.source,
    comment: o.comment ?? "",
  });
  if (editing)
    return (
      <Panel className="ok-detail" title={<>#{o.number} · {t.editTitle}</>} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={() => setEditing(false)}><Icon name="close" size={16} /></button>}>
        <OrderForm initial={draft()} edit={o.id} settings={settings} onDone={() => { setEditing(false); show(t.saved); refresh(); }} onCancel={() => setEditing(false)} />
        {flash}
      </Panel>
    );
  const setPayment = (status: Payment) => {
    if (status === "prepaid") return; // the amount comes first (the form below)
    setAskPrepaid(false);
    void patch({ payment: { status } }, t.saved);
  };
  const cod = o.payment === "cod";

  return (
    <Panel className="ok-detail" title={<>#{o.number} · {o.customerName}</>} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={onClose}><Icon name="close" size={16} /></button>}>
      <div className="app-order-top">
        <StatusBadge status={o.status} statusId={o.statusId} settings={settings} />
        {o.totalKop !== null && <b className="num app-secret">{money(o.totalKop)}</b>}
        {o.paymentStatus && <span className="ok-pill" data-pay={o.paymentStatus}>{t.paymentStates[o.paymentStatus]}</span>}
      </div>
      {o.status === "cancelled" && o.cancelReason && <p className="ok-note">{fmt(t.reasonShown, { r: reasonText(o.cancelReason) })}</p>}
      {o.duplicates.length > 0 && o.status !== "cancelled" && (
        <div className="ok-note app-dup" role="status">
          <span>{fmt(t.duplicate, { list: o.duplicates.map((x) => `№${x.number}`).join(", ") })}</span>
          {editable && o.duplicates.filter((x) => x.status === "new" || x.status === "confirmed").map((x) => (
            <button key={x.id} type="button" className="btn btn-sm btn-secondary" onClick={() => post("merge", { other: x.id }, fmt(t.merged, { n: x.number }))}>{fmt(t.mergeWith, { n: x.number })}</button>
          ))}
        </div>
      )}
      {o.callbackAt && (o.status === "new" || o.status === "confirmed") && <p className="ok-note">{fmt(t.callbackAt, { t: f.dateTime(new Date(o.callbackAt).getTime()) })}</p>}
      {!shippingOnly && (
        <p className="app-assignee">
          <Icon name="person" size={15} />
          {o.assignee ? fmt(t.assignee, { name: o.assignee }) : t.noAssignee}
          {o.assignee !== meName && !o.isExample && <button type="button" className="ok-link" onClick={() => post("take", undefined, t.taken)}>{t.take}</button>}
        </p>
      )}
      {shippingOnly ? (
        o.status === "confirmed" && <div className="ok-actions"><button type="button" className="btn btn-sm" onClick={() => changeStatus({ status: "shipped", statusId: null })}>{t.markShipped}</button></div>
      ) : (
        <div className="ok-actions">
          <label className="ok-select">
            <span className="sr-only">{d.ok.orders.changeStatus}</span>
            <select value={current} onChange={(e) => pickStatus(e.target.value)}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={d.ok.orders.status[g]}>
                  <option value={`g:${g}`}>{d.ok.orders.status[g]}</option>
                  {settings?.statuses.filter((s) => s.group === g).map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {editable && <button type="button" className="btn btn-sm btn-secondary" onClick={() => post("no-answer", undefined, t.noAnswerDone)}><Icon name="phone" size={14} />{t.noAnswer}</button>}
          {editable && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditing(true)}>{t.edit}</button>}
          {o.status !== "cancelled" && <button type="button" className="btn btn-sm btn-ghost ok-danger" onClick={() => setCancelling({ statusId: null })}>{t.cancelOrder}</button>}
        </div>
      )}
      <div className="ok-kv">
        <div><span>{d.ok.orders.date}</span><b>{f.dateTime(new Date(o.createdAt).getTime())}</b></div>
        {o.source !== "site" && <div><span>{d.app.analytics.sources}</span><b>{(t.sources as Record<string, string>)[o.source] ?? o.source}{o.externalId ? ` · №${o.externalId}` : ""}</b></div>}
        <div><span>{t.customer}</span><b>{shippingOnly ? <span className="app-secret">{o.customerPhone}</span> : <a className="ok-link app-secret" href={`tel:${o.customerPhone.replace(/[^\d+]/g, "")}`}>{o.customerPhone}</a>}{o.customerEmail ? ` · ${o.customerEmail}` : ""}</b></div>
        <div><span>{t.delivery}</span><b>{t.methods[o.delivery.method as keyof typeof t.methods] ?? o.delivery.method}{[o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).length ? `: ${[o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).join(", ")}` : ""}</b></div>
        <div><span>{t.payment}</span><b>{t.payments[o.payment as keyof typeof t.payments] ?? o.payment}</b></div>
        {o.comment && <div><span>{t.comment}</span><b>{o.comment}</b></div>}
      </div>
      <div className="ok-sub">{t.items}</div>
      <ul className="ok-list">
        {o.items.map((i, n) => (
          <li key={`${i.productId}-${n}`}><span className="ok-grow">{i.name} × {i.qty}</span>{i.priceKop !== null && <span className="num app-secret">{money(i.priceKop * i.qty)}</span>}</li>
        ))}
        {o.totalKop !== null && <li><b className="ok-grow">{t.total}</b><b className="num app-secret">{money(o.totalKop)}</b></li>}
      </ul>
      {o.paymentStatus && !shippingOnly && (
        <>
          <div className="ok-sub">{t.paymentTitle}</div>
          <div className="ok-chips" role="group" aria-label={t.paymentTitle}>
            {PAYMENTS.map((p) => (
              <button key={p} type="button" className="ok-chip" aria-pressed={o.paymentStatus === p} onClick={() => (p === "prepaid" ? setAskPrepaid(true) : setPayment(p))}>{t.paymentStates[p]}</button>
            ))}
          </div>
          {(o.paymentStatus === "prepaid" || askPrepaid) && (
            <form className="ok-form-row" onSubmit={(e) => { e.preventDefault(); void patch({ payment: { status: "prepaid", prepaidKop: Math.round(Number(prepaid.replace(",", ".")) * 100) } }, t.saved); }}>
              <Field label={t.prepaidAmount} hint={cod && o.totalKop !== null && Number(prepaid) > 0 ? fmt(t.codRest, { sum: money(o.totalKop - Math.round(Number(prepaid.replace(",", ".")) * 100)) }) : undefined}>
                {(p) => <input {...p} className="input" inputMode="decimal" value={prepaid} onChange={(e) => setPrepaid(e.target.value.replace(/[^\d.,]/g, ""))} />}
              </Field>
              <span />
              <button className="btn btn-sm" type="submit" disabled={!(Number(prepaid.replace(",", ".")) > 0)}>{t.save}</button>
            </form>
          )}
        </>
      )}
      {o.isExample && <p className="ok-note">{t.exampleDetail}</p>}
      {!o.isExample && (o.delivery.method === "novaposhta" || o.delivery.method === "ukrposhta") && o.status !== "cancelled" && (
        o.waybillRef ? (
          <div className="ok-actions"><b className="num">{t.waybill}: {o.waybill}</b><WaybillPrint orderId={o.id} provider={o.delivery.method} /></div>
        ) : !o.waybill ? (
          <WaybillForm key={o.delivery.method} provider={o.delivery.method} orderId={o.id} notify={show} onCreated={refresh} />
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
      <form className="app-comment-form" onSubmit={async (e) => { e.preventDefault(); if (comment.trim() && (await post("comments", { text: comment.trim() }))) setComment(""); }}>
        <label className="sr-only" htmlFor={`c-${o.id}`}>{t.commentAdd}</label>
        <input id={`c-${o.id}`} className="input" maxLength={2000} placeholder={t.commentAdd} value={comment} onChange={(e) => setComment(e.target.value)} />
        <button type="submit" className="btn btn-sm btn-secondary" disabled={!comment.trim()}>{t.commentSend}</button>
      </form>
      <History events={o.events} />
      <CancelDialog
        key={cancelling ? "open" : "closed"}
        open={!!cancelling}
        settings={settings}
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => {
          const to = { status: "cancelled" as const, statusId: cancelling?.statusId ?? null };
          setCancelling(null);
          void changeStatus(to, reason);
        }}
      />
      {flash}
    </Panel>
  );
}

const FILTERS = ["all", "new", "callback", "nowaybill", "confirmed", "shipped", "done", "cancelled", "returned"] as const;
/** «Комплектувальник» works only with orders waiting to be sent. */
const SHIP_FILTERS = ["all", "nowaybill", "confirmed", "shipped"] as const;
type Filter = (typeof FILTERS)[number];

/** `tab` from the address: a filter ("new", "nowaybill", …) or "o-<id>" to open one order (links from Home). */
/** `tab` "new-order" opens the manual order form (Home, «N», the round «+»). */
export function OrdersScreen({ tab, shippingOnly = false, finance = true, meName = "" }: { tab?: string | null; shippingOnly?: boolean; finance?: boolean; meName?: string }) {
  const d = useDict();
  const t = d.app.orders;
  const lang = useLang();
  const f = useFormat();
  const { settings } = useOrderSettings();
  const [filter, setFilter] = useState<Filter>((FILTERS as readonly string[]).includes(tab ?? "") ? (tab as Filter) : "all");
  const [pay, setPay] = useState<Payment | "all">("all");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(tab?.startsWith("o-") ? tab.slice(2) : !shippingOnly && tab === "new-order" ? "new" : null);
  const [next] = useState(latestOnly);
  const load = useCallback(async () => {
    const isLatest = next();
    const q = new URLSearchParams({ sort: sort.key, dir: sort.dir, page: String(page), limit: String(PAGE + 1), ...(filter === "all" ? {} : { status: filter }), ...(pay === "all" ? {} : { payment: pay }) });
    const r = await api<OrderRow[]>(`/shop/orders?${q}`);
    if (r.ok && isLatest()) {
      setRows(r.data.slice(0, PAGE));
      setMore(r.data.length > PAGE);
    }
  }, [filter, pay, sort, page, next]);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);
  useEscClose(open ? () => setOpen(null) : null);
  const toast = useToast();
  // Phone: swipe a new order to the right to take it in work (with «Скасувати»).
  const confirm = async (o: OrderRow) => {
    const r = await api(`/shop/orders/${o.id}`, { method: "PATCH", body: { status: "confirmed" } });
    void load();
    if (!r.ok) return toast.show(r.error === "out_of_stock" ? t.outOfStock : d.app.auth.errors.server_error, "warn");
    toast.undo(fmt(t.statusChanged, { n: o.number, s: d.ok.orders.status.confirmed }), {
      undo: async () => {
        await api(`/shop/orders/${o.id}`, { method: "PATCH", body: { status: "new" } });
        void load();
      },
    });
  };
  // Phone: swipe to the left — «Не додзвонились», call again in 2 hours.
  const noAnswer = async (o: OrderRow) => {
    const r = await api(`/shop/orders/${o.id}/no-answer`, { method: "POST", body: {} });
    void load();
    toast.show(r.ok ? fmt(t.noAnswerFor, { n: o.number }) : d.app.auth.errors.server_error, r.ok ? "ok" : "warn");
  };
  const cols: Col<OrderRow>[] = [
    { key: "number", label: t.colNumber, sort: true, render: (o) => <span className="num ok-muted">#{o.number}</span> },
    {
      key: "customer",
      label: t.customer,
      sort: true,
      fixed: true,
      render: (o) => (
        <span className="app-cell-main">
          <b>{o.customerName}{o.isExample && <span className="ok-pill app-example-pill">{t.example}</span>}</b>
          {o.source !== "site" && <small>{(t.sources as Record<string, string>)[o.source] ?? o.source}</small>}
        </span>
      ),
    },
    { key: "phone", label: t.phone, render: (o) => <span className="num app-secret">{o.customerPhone}</span> },
    { key: "createdAt", label: d.ok.orders.date, sort: true, render: (o) => <span title={f.dateTime(new Date(o.createdAt).getTime())}>{f.ago(new Date(o.createdAt).getTime())}</span> },
    ...(finance
      ? [
          { key: "total", label: t.total, sort: true as const, align: "end" as const, render: (o: OrderRow) => (o.totalKop === null ? null : <span className="num app-secret">{formatUAH(o.totalKop / 100, lang)}</span>) },
          { key: "payment", label: t.paymentTitle, render: (o: OrderRow) => (o.paymentStatus ? <span className="ok-pill" data-pay={o.paymentStatus}>{t.paymentStates[o.paymentStatus]}</span> : null) },
        ]
      : []),
    { key: "waybill", label: t.waybill, render: (o) => (o.waybill ? <span className="num">{o.waybill}</span> : null) },
    { key: "status", label: d.ok.orders.state, sort: true, render: (o) => <StatusBadge status={o.status} statusId={o.statusId} settings={settings} /> },
  ];
  return (
    <div className="ok-screen">
      <div className="ok-h">
        <h3>{t.title}</h3>
        {!shippingOnly && <button type="button" className="btn btn-sm" onClick={() => setOpen("new")}><Icon name="plus" size={15} />{t.addOrder}</button>}
      </div>
      <div className="ok-chips" role="group" aria-label={d.ok.orders.state}>
        {(shippingOnly ? SHIP_FILTERS : FILTERS).map((x) => (
          <button key={x} type="button" className="ok-chip" aria-pressed={filter === x} onClick={() => { setFilter(x); setPage(1); }}>{x === "all" ? t.all : x === "nowaybill" ? t.noWaybill : x === "callback" ? t.callbackFilter : d.ok.orders.status[x]}</button>
        ))}
        {finance && (
          <label className="ok-select app-filter-select">
            <span className="sr-only">{t.paymentTitle}</span>
            <select value={pay} onChange={(e) => { setPay(e.target.value as Payment | "all"); setPage(1); }}>
              <option value="all">{t.paymentAll}</option>
              {PAYMENTS.map((p) => <option key={p} value={p}>{t.paymentStates[p]}</option>)}
            </select>
          </label>
        )}
      </div>
      {!shippingOnly && rows?.some((o) => o.isExample) && (
        <p className="ok-note app-example-note">
          {t.exampleNote}{" "}
          <button type="button" className="ok-link" onClick={async () => { await api("/onboarding/examples", { method: "DELETE" }); setOpen(null); void load(); }}>{t.exampleRemove}</button>
        </p>
      )}
      <div className="ok-split" data-open={!!open}>
        <Panel>
          {rows && rows.length === 0 && page === 1 ? (
            <Empty icon="cart" text={t.empty} />
          ) : (
            <Table id="orders" label={t.title} rows={rows ?? []} cols={cols} active={open} onOpen={(o) => setOpen(o.id)} sort={sort} onSort={setSort} page={page} onPage={setPage} hasMore={more} onSwipeRight={shippingOnly ? undefined : (o) => { if (o.status === "new") void confirm(o); }} onSwipeLeft={shippingOnly ? undefined : (o) => { if (o.status === "new" || o.status === "confirmed") void noAnswer(o); }} />
          )}
        </Panel>
        {open === "new" && (
          <Panel className="ok-detail" title={t.addOrder} action={<button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={d.app.toast.close} onClick={() => setOpen(null)}><Icon name="close" size={16} /></button>}>
            <OrderForm
              initial={emptyOrder()}
              settings={settings}
              onDone={(id, number) => { toast.show(fmt(t.created, { n: number ?? "" })); setOpen(id); void load(); }}
              onCancel={() => setOpen(null)}
            />
          </Panel>
        )}
        {open && open !== "new" && <OrderDetail id={open} key={open} onChanged={load} shippingOnly={shippingOnly} settings={settings} meName={meName} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}
