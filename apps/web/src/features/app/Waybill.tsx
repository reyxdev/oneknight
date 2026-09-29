"use client";

import { useState, type FormEvent } from "react";
import { useDict, useLang } from "@/i18n/provider";
import { fmt } from "@/i18n";
import { formatUAH } from "@/data/pricing";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { NpPicker, type Carrier, type NpCity, type NpPick, type NpWarehouse } from "./Integrations";

type Draft =
  | { moduleActive: false; connected: boolean }
  | { moduleActive: true; connected: false }
  | {
      moduleActive: true;
      connected: true;
      sender: { city: NpCity; warehouse: NpWarehouse } | null;
      recipient: { city: NpCity | null; warehouse: NpWarehouse | null; cities: NpCity[]; warehouses: NpWarehouse[] };
      weight: number;
      size?: { length: number; width: number; height: number };
      description: string;
      cod: number;
    };

/** Print links go through the API, which fetches the PDF from Nova Poshta with the stored key. */
export function WaybillPrint({ orderId, provider }: { orderId: string; provider: Carrier }) {
  const t = useDict().app.orders;
  const base = `/api/integrations/${provider}/print/${orderId}`;
  return (
    <span className="ok-actions">
      <a className="btn btn-sm" href={`${base}?kind=document`} target="_blank" rel="noopener"><Icon name="doc" size={15} />{provider === "ukrposhta" ? t.printUpA4 : t.printDoc}</a>
      <a className="btn btn-sm btn-secondary" href={`${base}?kind=marking`} target="_blank" rel="noopener">{t.printLabel}</a>
    </span>
  );
}

/**
 * «Оформити ТТН»: the form opens only when the order needs it. Sender address and weight are remembered
 * from the previous waybill; the recipient comes from the order; cash on delivery follows the order payment.
 */
export function WaybillForm({ provider, orderId, onCreated, notify }: { provider: Carrier; orderId: string; onCreated: () => void; notify: (text: string, tone?: "warn") => void }) {
  const d = useDict();
  const t = d.app.orders;
  const lang = useLang();
  const [draft, setDraft] = useState<Draft | null | "loading">(null);
  const [sender, setSender] = useState<NpPick>({ city: null, warehouse: null });
  const [recipient, setRecipient] = useState<NpPick>({ city: null, warehouse: null });
  const [weight, setWeight] = useState("1");
  const [cargo, setCargo] = useState("");
  const [size, setSize] = useState({ length: "30", width: "20", height: "10" });
  const up = provider === "ukrposhta";
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setDraft("loading");
    const r = await api<Draft>(`/integrations/${provider}/draft/${orderId}`);
    if (!r.ok) {
      setDraft(null);
      return notify(d.app.auth.errors.server_error, "warn");
    }
    const x = r.data;
    if (x.moduleActive && x.connected) {
      setSender(x.sender ? { city: x.sender.city, warehouse: x.sender.warehouse } : { city: null, warehouse: null });
      setRecipient({ city: x.recipient.city, warehouse: x.recipient.warehouse });
      setWeight(String(x.weight));
      setCargo(x.description);
      if (x.size) setSize({ length: String(x.size.length), width: String(x.size.width), height: String(x.size.height) });
    }
    setDraft(x);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!sender.city || !sender.warehouse || !recipient.city || !recipient.warehouse) return notify(t.needPlaces, "warn");
    setBusy(true);
    const r = await api<{ number: string }>(`/integrations/${provider}/waybill`, {
      method: "POST",
      body: {
        orderId,
        sender: { cityRef: sender.city.ref, cityName: sender.city.name, warehouseRef: sender.warehouse.ref, warehouseName: sender.warehouse.name },
        recipient: { cityRef: recipient.city.ref, warehouseRef: recipient.warehouse.ref },
        weight: Number(weight.replace(",", ".")) || 1,
        ...(up ? { size: { length: Number(size.length) || 1, width: Number(size.width) || 1, height: Number(size.height) || 1 } } : {}),
        ...(cargo.trim() ? { description: cargo.trim() } : {}),
      },
    });
    setBusy(false);
    if (!r.ok) {
      playSound("error");
      const detail = (r.body as { detail?: string } | undefined)?.detail;
      return notify(`${(t.waybillErrors as Record<string, string>)[r.error] ?? d.app.auth.errors.server_error}${detail ? `: ${detail}` : ""}`, "warn");
    }
    playSound("success");
    notify(fmt(t.waybillCreated, { n: r.data.number }));
    setDraft(null);
    onCreated();
  };

  if (draft === null)
    return (
      <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={open}>
        <Icon name="truck" size={15} />{t.createWaybill}
      </button>
    );
  if (draft === "loading") return <p className="ok-muted" role="status">{t.loadingDraft}</p>;
  if (!draft.moduleActive || !draft.connected) {
    const needModule = !draft.moduleActive;
    return (
      <div className="ok-note app-waybill-need">
        <span className="ok-grow">{needModule ? (up ? t.needModuleUp : t.needModule) : up ? t.needKeyUp : t.needKey}</span>
        <a className="ok-link" href={needModule ? "#modules" : "#integrations"}>{needModule ? t.goModules : t.goIntegrations}</a>
      </div>
    );
  }
  const ambiguous = !draft.recipient.city || !draft.recipient.warehouse;
  return (
    <form className="app-waybill grid gap-3" onSubmit={submit}>
      <div className="ok-sub">{up ? t.waybillTitleUp : t.waybillTitle}</div>
      <NpPicker provider={provider} labels={{ city: t.senderCity, branch: t.senderBranch }} value={sender} onChange={setSender} />
      {ambiguous && <p className="ok-note">{t.pickRecipient}</p>}
      <NpPicker provider={provider} labels={{ city: t.recipientCity, branch: t.recipientBranch }} value={recipient} onChange={setRecipient} initialCities={draft.recipient.cities} initialWarehouses={draft.recipient.warehouses} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.weight}>{(p) => <input {...p} className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />}</Field>
        <Field label={t.cargo}>{(p) => <input {...p} className="input" maxLength={100} value={cargo} onChange={(e) => setCargo(e.target.value)} />}</Field>
      </div>
      {up && (
        <fieldset className="app-size">
          <legend>{t.size}</legend>
          {(["length", "width", "height"] as const).map((k) => (
            <input key={k} className="input" inputMode="numeric" aria-label={t.dims[k]} placeholder={t.dims[k]} value={size[k]} onChange={(e) => setSize({ ...size, [k]: e.target.value.replace(/\D/g, "") })} />
          ))}
        </fieldset>
      )}
      <p className="ok-muted">{draft.cod > 0 ? fmt(t.cod, { sum: formatUAH(draft.cod, lang) }) : t.noCod}</p>
      <div className="ok-actions">
        <button className="btn btn-sm" type="submit" disabled={busy} data-loading={busy}>{busy ? t.creatingWaybill : t.submitWaybill}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>{t.cancelWaybill}</button>
      </div>
    </form>
  );
}
