"use client";

import { useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Field } from "@/components/ui/Field";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash } from "@/features/oneknight/ui/kit";
import { BackupsPanel } from "./Backups";

export function ProfileScreen({ me, onChange }: { me: Me; onChange: () => void }) {
  const d = useDict();
  const t = d.app.account;
  const [flash, show] = useFlash();
  const org = me.organizations.find((o) => o.id === me.activeOrgId) ?? me.organizations[0];
  const owner = me.role === "owner";
  const [f, setF] = useState({ name: me.name, phone: me.phone, businessName: org?.name ?? "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const err = (e: string) => (t.errors as Record<string, string>)[e] ?? d.app.auth.errors.server_error;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: f.name, phone: f.phone, ...(owner && f.businessName !== org?.name ? { businessName: f.businessName } : {}) };
    const r = await api("/auth/profile", { method: "PATCH", body });
    if (!r.ok) {
      playSound("error");
      return show(err(r.error), "warn");
    }
    playSound("success");
    show(t.saved);
    onChange();
  };
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return show(d.app.auth.errors.passwordShort, "warn");
    const r = await api("/auth/password", { method: "POST", body: pw });
    if (!r.ok) {
      playSound("error");
      return show(err(r.error), "warn");
    }
    playSound("success");
    setPw({ current: "", next: "" });
    show(t.passwordChanged);
  };

  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Panel>
        <form className="grid gap-3" onSubmit={save} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.name}>{(p) => <input {...p} className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label={t.phone}>{(p) => <input {...p} className="input" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
            {owner && <Field label={t.businessName}>{(p) => <input {...p} className="input" maxLength={120} value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} />}</Field>}
          </div>
          <div className="ok-kv">
            <div><span>{t.email}</span><b>{me.email}</b></div>
            {org && <div><span>{t.business}</span><b>{org.name} · {t.roles[org.role]}</b></div>}
          </div>
          <button className="btn btn-sm" type="submit" style={{ justifySelf: "start" }}>{t.save}</button>
        </form>
      </Panel>
      <Panel title={t.passwordTitle}>
        <form className="grid gap-3" onSubmit={change} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.currentPassword}>{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
            <Field label={t.newPassword} hint={d.app.auth.passwordHint}>{(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
          </div>
          <button className="btn btn-sm btn-secondary" type="submit" disabled={!pw.current || !pw.next} style={{ justifySelf: "start" }}>{t.changePassword}</button>
        </form>
      </Panel>
      {owner && <BackupsPanel />}
      {flash}
    </div>
  );
}
