"use client";

import { useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Field } from "@/components/ui/Field";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash } from "@/features/oneknight/ui/kit";
import { TelegramPanel } from "./TelegramPanel";
import { Security } from "./Security";
import { Tabs } from "./Tabs";

export type ProfileTab = "profile" | "security" | "notifications";
export const PROFILE_TABS: ProfileTab[] = ["profile", "security", "notifications"];

/** «Мій профіль»: personal things only; business settings live in «Бізнес». */
export function ProfileScreen({ me, tab, setTab, onChange }: { me: Me; tab: ProfileTab; setTab: (t: ProfileTab) => void; onChange: () => void }) {
  const d = useDict();
  const t = d.app.account;
  const [flash, show] = useFlash();
  const org = me.organizations.find((o) => o.id === me.activeOrgId) ?? me.organizations[0];
  const [f, setF] = useState({ name: me.name, phone: me.phone });
  const [pw, setPw] = useState({ current: "", next: "" });
  const err = (e: string) => (t.errors as Record<string, string>)[e] ?? d.app.auth.errors.server_error;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: f.name, phone: f.phone };
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
      <div className="ok-h"><h3>{d.app.nav.myProfile}</h3></div>
      <Tabs label={d.app.nav.myProfile} value={tab} onChange={setTab} tabs={PROFILE_TABS.map((id) => ({ id, label: d.app.profileTabs[id] }))} />
      {tab === "security" && <Security me={me} onChange={onChange} embedded />}
      {tab === "notifications" && <TelegramPanel />}
      {tab === "profile" && (
      <>
      <Panel>
        <form className="grid gap-3" onSubmit={save} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.name}>{(p) => <input {...p} className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label={t.phone}>{(p) => <input {...p} className="input" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
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
      </>
      )}
      {flash}
    </div>
  );
}
