"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Icon } from "@/components/ui/Icon";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { readImage } from "@/lib/files";
import { playSound } from "@/lib/sound";
import { Panel, useFlash } from "@/features/oneknight/ui/kit";
import type { Requisites } from "./documents";

/** The business's requisites for its documents; everyone who prints reads them, the owner changes them. */
export function useRequisites() {
  const [data, setData] = useState<{ requisites: Requisites | null; canEdit: boolean } | null>(null);
  const load = async () => {
    const r = await api<{ requisites: Requisites | null; canEdit: boolean }>("/business/requisites");
    if (r.ok) setData(r.data);
  };
  useEffect(() => {
    void load();
  }, []);
  return { data, reload: load };
}

type Img = { name: string; data: string } | null | undefined;

/** «Бізнес → Реквізити й документи». */
export function RequisitesPanel() {
  const t = useDict().app.requisites;
  const [flash, show] = useFlash();
  const { data, reload } = useRequisites();
  const [f, setF] = useState<Omit<Requisites, "signature" | "stamp"> | null>(null);
  const [sig, setSig] = useState<Img>(undefined);
  const [stamp, setStamp] = useState<Img>(undefined);
  const [bad, setBad] = useState<string[]>([]);
  useEffect(() => {
    if (data && !f) {
      const r = data.requisites;
      setF(r ? { kind: r.kind, name: r.name, code: r.code ?? "", iban: r.iban ?? "", bank: r.bank ?? "", address: r.address ?? "", phone: r.phone ?? "", email: r.email ?? "", vat: r.vat, vatNumber: r.vatNumber ?? "", signer: r.signer ?? "" } : { kind: "fop", name: "", code: "", iban: "", bank: "", address: "", phone: "", email: "", vat: false, vatNumber: "", signer: "" });
    }
  }, [data, f]);
  if (!data || !f) return null;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api<unknown>("/business/requisites", { method: "PUT", body: { ...f, iban: f.iban?.replace(/\s/g, "").toUpperCase(), ...(sig !== undefined ? { signature: sig } : {}), ...(stamp !== undefined ? { stamp } : {}) } });
    if (!r.ok) {
      playSound("error");
      setBad(((r.body as { fields?: string[] } | undefined)?.fields ?? []).map(String));
      return show(t.invalid, "warn");
    }
    setBad([]);
    playSound("success");
    show(t.saved);
    setSig(undefined);
    setStamp(undefined);
    void reload();
  };
  const image = (label: string, current: string | null, value: Img, setter: (v: Img) => void) => {
    const src = value ? value.data : value === null ? null : current;
    return (
      <div className="app-seal">
        <span className="app-seal-label">{label}</span>
        {src ? <img src={src} alt="" /> : <span className="ok-muted">{t.noImage}</span>}
        <div className="ok-actions">
          <label className="btn btn-sm btn-secondary">
            <Icon name="image" size={14} />{t.upload}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setter(await readImage(file)); }} />
          </label>
          {src && <button type="button" className="ok-link ok-danger" onClick={() => setter(null)}>{t.remove}</button>}
        </div>
      </div>
    );
  };
  const err = (k: string) => (bad.includes(k) ? (t.errors as Record<string, string>)[k] ?? t.invalid : undefined);
  const disabled = !data.canEdit;
  return (
    <Panel title={t.title}>
      <p className="ok-muted">{t.lead}</p>
      <form className="grid gap-3" onSubmit={save} noValidate>
        <fieldset className="grid gap-3" disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.kind}>
              {(p) => (
                <select {...p} className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Requisites["kind"] })}>
                  {(["fop", "tov", "person"] as const).map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
                </select>
              )}
            </Field>
            <Field label={t.name} error={err("name")}>{(p) => <input {...p} className="input" value={f.name} onChange={set("name")} />}</Field>
            <Field label={f.kind === "tov" ? t.edrpou : t.rnokpp} error={err("code")}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={10} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />}</Field>
            <Field label="IBAN" error={err("iban")}>{(p) => <input {...p} className="input" spellCheck={false} value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value.replace(/\s/g, "").toUpperCase().slice(0, 29) })} />}</Field>
            <Field label={t.bank}>{(p) => <input {...p} className="input" value={f.bank} onChange={set("bank")} />}</Field>
            <Field label={t.address}>{(p) => <input {...p} className="input" value={f.address} onChange={set("address")} />}</Field>
            <Field label={t.phone}>{(p) => <input {...p} className="input" type="tel" value={f.phone} onChange={set("phone")} />}</Field>
            <Field label={t.email}>{(p) => <input {...p} className="input" type="email" value={f.email} onChange={set("email")} />}</Field>
            <Field label={t.signer}>{(p) => <input {...p} className="input" value={f.signer} onChange={set("signer")} />}</Field>
          </div>
          <Toggle checked={f.vat} onChange={(v) => setF({ ...f, vat: v })} label={t.vat} />
          {f.vat && <Field label={t.vatNumber}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={12} value={f.vatNumber} onChange={set("vatNumber")} />}</Field>}
          <div className="grid gap-3 sm:grid-cols-2">
            {image(t.signature, data.requisites?.signature ?? null, sig, setSig)}
            {image(t.stamp, data.requisites?.stamp ?? null, stamp, setStamp)}
          </div>
        </fieldset>
        {data.canEdit ? <button className="btn btn-sm" type="submit" style={{ justifySelf: "start" }}>{t.save}</button> : <p className="ok-muted">{t.ownerOnly}</p>}
      </form>
      {flash}
    </Panel>
  );
}
