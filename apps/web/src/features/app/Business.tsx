"use client";

import { useState, type FormEvent } from "react";
import { useDict } from "@/i18n/provider";
import { Field } from "@/components/ui/Field";
import { api, type Me } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { Panel, useFlash } from "@/features/oneknight/ui/kit";
import { Tabs } from "./Tabs";
import { IntegrationsScreen } from "./Integrations";
import { BackupsPanel } from "./Backups";
import { BusinessOrders } from "./BusinessOrders";

export type BusinessTab = "general" | "orders" | "integrations" | "backups";
export const BUSINESS_TABS: BusinessTab[] = ["general", "orders", "integrations", "backups"];

function General({ me, onChange }: { me: Me; onChange: () => void }) {
  const t = useDict().app.business;
  const [flash, show] = useFlash();
  const org = me.organizations.find((o) => o.id === me.activeOrgId) ?? me.organizations[0];
  const [name, setName] = useState(org?.name ?? "");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api("/auth/profile", { method: "PATCH", body: { businessName: name } });
    if (!r.ok) return playSound("error");
    playSound("success");
    show(t.saved);
    onChange();
  };
  return (
    <Panel>
      <form className="grid gap-3" onSubmit={save} noValidate>
        <Field label={t.name}>{(p) => <input {...p} className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <button className="btn btn-sm" type="submit" disabled={name.trim().length < 2 || name === org?.name} style={{ justifySelf: "start" }}>{t.save}</button>
      </form>
      {flash}
    </Panel>
  );
}

/**
 * «Бізнес»: settings of the whole business, owner only. Tabs appear only once they work (owner's decision);
 * requisites, working hours, statuses, checkout, clients and goals are added in later stages.
 */
export function BusinessScreen({ me, tab, setTab, onChange }: { me: Me; tab: BusinessTab; setTab: (t: BusinessTab) => void; onChange: () => void }) {
  const t = useDict().app.business;
  if (me.role !== "owner") return <p className="ok-muted">{t.ownerOnly}</p>;
  return (
    <div className="ok-screen">
      <div className="ok-h"><h3>{t.title}</h3></div>
      <Tabs label={t.title} value={tab} onChange={setTab} tabs={BUSINESS_TABS.map((id) => ({ id, label: t.tabs[id] }))} />
      {tab === "general" && <General me={me} onChange={onChange} />}
      {tab === "orders" && <BusinessOrders />}
      {tab === "integrations" && <IntegrationsScreen embedded />}
      {tab === "backups" && <BackupsPanel />}
    </div>
  );
}
